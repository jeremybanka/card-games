import { createServer } from "node:http"
import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	writeFile,
} from "node:fs/promises"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { findState, getState, setState } from "atom.io"
import type { UserKey } from "atom.io/realtime"
import type { UserServerConfig } from "atom.io/realtime-server"
import { realtime, realtimeStateProvider } from "atom.io/realtime-server"
import { Server, type Socket } from "socket.io"
import { Squirrel, type CacheMode } from "varmint"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { parsePlayCardPayload } from "../game/game-actions.ts"
import {
	createOhHellGame,
	joinOhHellGame,
	playOhHellCard,
	startNextOhHellRound,
	startOhHellGame,
	submitOhHellBid,
	type OhHellState,
} from "../game/oh-hell-engine.ts"
import { createSeededRandom } from "../game/seeded-random.ts"
import {
	gameStateAtoms,
	privatePlayerViewAtom,
	privatePlayerViewProjectionSelectors,
	publicGameViewAtom,
	publicGameViewProjectionSelectors,
} from "../game/game-state-atoms.ts"
import { createPhysicalCardIds } from "../game/standard-deck-domain.ts"
import type {
	ActionAck,
	CardId,
	ClientToServerEvents,
	PlayerId,
	ServerToClientEvents,
} from "../game/game-types.ts"
import {
	type LogLevel,
	serverLogger,
} from "../observability/span-logger.node.ts"
import {
	createOpenAiTurnGenerator,
	type AiModelResponseRecord,
	wrapAiGeneratorWithVarmint,
} from "./ai-generator.node.ts"
import { renderAiGameFacts } from "./ai-game-facts.ts"
import type { AiModelId } from "./ai-models.ts"
import { createAiPlayer, type AiPlayerRuntime } from "./ai-player.node.ts"
import {
	fallbackAiDecision,
	type AiFallbackReason,
	type AiTurnGenerator,
} from "./ai-strategy.ts"
import type { AiTurnDecision } from "./ai-types.ts"

const roomCode = "HELL"
const invariantSeed = "oh-hell-sol-vs-three-luna-v1"
const liveInvariantSeed = "oh-hell-sol-vs-three-luna-live-v1"
const liveRecordingName =
	process.env.OH_HELL_AI_GAME_RECORDING_NAME?.trim() ||
	"sol-vs-three-luna-live-v1-compact-strategy"
const liveCacheMode: CacheMode =
	process.env.OH_HELL_AI_GAME_CACHE_MODE === "read" ? "read" : "write"
const bots = [
	{
		id: "user::00000000-0000-4000-8000-000000000001",
		modelId: "gpt-5.6-sol",
		name: "Sol Bot",
		secret: "10000000-0000-4000-8000-000000000001",
	},
	{
		id: "user::00000000-0000-4000-8000-000000000002",
		modelId: "gpt-5.6-luna",
		name: "Luna Bot 1",
		secret: "10000000-0000-4000-8000-000000000002",
	},
	{
		id: "user::00000000-0000-4000-8000-000000000003",
		modelId: "gpt-5.6-luna",
		name: "Luna Bot 2",
		secret: "10000000-0000-4000-8000-000000000003",
	},
	{
		id: "user::00000000-0000-4000-8000-000000000004",
		modelId: "gpt-5.6-luna",
		name: "Luna Bot 3",
		secret: "10000000-0000-4000-8000-000000000004",
	},
] as const satisfies readonly {
	id: PlayerId
	modelId: AiModelId
	name: string
	secret: string
}[]

type Bot = (typeof bots)[number]
type BotSocket = Socket<
	ClientToServerEvents,
	ServerToClientEvents,
	Record<string, never>,
	Record<string, never>
>

type TranscriptEntry =
	| {
			action: "submitBid"
			bid: number
			playerId: PlayerId
			roundNumber: number
	  }
	| {
			action: "playCard"
			cardId: CardId
			completedTrickWinnerId: PlayerId | null
			playerId: PlayerId
			roundNumber: number
			scores: Array<{
				bid: number | null
				playerId: PlayerId
				roundPoints: number
				score: number
				tricksWon: number
			}>
			trickNumber: number
			value: OhHellState["cardValues"][CardId]
	  }

type BotRun = {
	cacheOutputCount: number
	finalState: OhHellState
	generatorCalls: number
	transcript: TranscriptEntry[]
}

type BotTableOptions = {
	createGenerator?: (bot: Bot, squirrel: Squirrel) => AiTurnGenerator
	seed?: string
	timeout?: number
}

type LiveDecisionRecord = {
	decision: AiTurnDecision
	modelId: AiModelId
	playerId: PlayerId
	prompt: string
	sequence: number
	source: "cache" | "fallback" | "model"
}

type LiveFallbackRecord = {
	error: { message: string; name: string } | string | null
	generated: unknown
	modelId: AiModelId
	prompt: string
	reason: AiFallbackReason
	sequence: number
}

type LiveModelResponseRecord = AiModelResponseRecord & {
	playerId: PlayerId
	sequence: number
}

function actionFailure(ack: ActionAck, error: unknown): void {
	ack({
		error: error instanceof Error ? error.message : "Action failed.",
		ok: false,
	})
}

function currentState(): OhHellState {
	const state = getState(gameStateAtoms, roomCode)
	if (state.gameKind !== "ohHell") throw new Error("Expected an Oh Hell table.")
	return state
}

async function waitForGameComplete(
	dealRandom: ReturnType<typeof createSeededRandom>,
	timeout: number,
): Promise<OhHellState> {
	const startedAt = Date.now()
	while (true) {
		const state = currentState()
		if (state.phase === "gameComplete") return state
		if (state.phase === "roundComplete") {
			setState(
				gameStateAtoms,
				roomCode,
				startNextOhHellRound(state, bots[0].id, dealRandom.next),
			)
		}
		if (Date.now() - startedAt > timeout) {
			throw new Error(
				`The four-bot Oh Hell game did not complete: ${JSON.stringify({
					currentPlayerId: state.currentPlayerId,
					phase: state.phase,
					players: state.players.map((player) => ({
						bid: player.bid,
						handSize: player.hand.length,
						id: player.id,
						tricksWon: player.tricksWon,
					})),
					roundNumber: state.roundNumber,
					trickNumber: state.trickNumber,
				})}`,
			)
		}
		await new Promise((resolve) => setTimeout(resolve, 5))
	}
}

async function runBotTable(
	mode: CacheMode,
	cacheDirectory: string,
	options: BotTableOptions = {},
): Promise<BotRun> {
	const seed = options.seed ?? invariantSeed
	const dealRandom = createSeededRandom(`deal:${roomCode}:${seed}`)
	const identityRandom = createSeededRandom(`identity:${roomCode}:${seed}`)
	const initial = createOhHellGame(
		roomCode,
		bots[0].id,
		bots[0].name,
		createPhysicalCardIds(identityRandom.uuid),
	)
	initial.players[0]!.aiModel = bots[0].modelId
	initial.players[0]!.kind = "ai"
	setState(gameStateAtoms, roomCode, initial)

	const transcript: TranscriptEntry[] = []
	const httpServer = createServer()
	const socketServer = new Server<
		ClientToServerEvents,
		ServerToClientEvents,
		Record<string, never>,
		Record<string, never>
	>(httpServer)

	realtime(
		socketServer as unknown as Server,
		(handshake) => {
			const rawPlayerId = handshake.auth.playerId
			const secret = handshake.auth.playerSecret
			const bot = bots.find(
				(candidate) =>
					candidate.id === `user::${String(rawPlayerId)}` &&
					candidate.secret === secret,
			)
			return bot === undefined
				? new Error("Unknown deterministic bot identity.")
				: (bot.id satisfies UserKey)
		},
		(socketInput: UserServerConfig) => {
			const playerId = socketInput.consumer as PlayerId
			const socket = socketInput.socket as unknown as BotSocket
			const bot = bots.find((candidate) => candidate.id === playerId)
			if (bot === undefined) throw new Error("Bot configuration missing.")

			socket.on("joinRoom", (requestedRoom, playerName, ack) => {
				try {
					if (requestedRoom !== roomCode) {
						throw new Error("Unknown deterministic bot room.")
					}
					setState(
						gameStateAtoms,
						roomCode,
						joinOhHellGame(currentState(), playerId, playerName, {
							aiModel: bot.modelId,
							kind: "ai",
						}),
					)
					const provideState = realtimeStateProvider({
						consumer: playerId,
						socket: socket as unknown as UserServerConfig["socket"],
					})
					const disposePublic = provideState(
						publicGameViewAtom,
						findState(publicGameViewProjectionSelectors, roomCode),
					)
					const disposePrivate = provideState(
						privatePlayerViewAtom,
						findState(privatePlayerViewProjectionSelectors, [
							roomCode,
							playerId,
						]),
					)
					socket.once("disconnect", () => {
						disposePrivate()
						disposePublic()
					})
					ack({ ok: true, roomCode })
				} catch (error) {
					actionFailure(ack, error)
				}
			})

			socket.on("submitBid", (bid, ack) => {
				try {
					const state = currentState()
					setState(
						gameStateAtoms,
						roomCode,
						submitOhHellBid(state, playerId, bid),
					)
					transcript.push({
						action: "submitBid",
						bid,
						playerId,
						roundNumber: state.roundNumber,
					})
					ack({ ok: true, roomCode })
				} catch (error) {
					actionFailure(ack, error)
				}
			})

			socket.on("playCard", (cardId, ack) => {
				try {
					const state = currentState()
					const payload = parsePlayCardPayload({ cardId })
					const nextState = playOhHellCard(state, playerId, payload.cardId)
					setState(gameStateAtoms, roomCode, nextState)
					transcript.push({
						action: "playCard",
						cardId: payload.cardId,
						completedTrickWinnerId:
							nextState.trickNumber > state.trickNumber ||
							nextState.phase === "roundComplete" ||
							nextState.phase === "gameComplete"
								? nextState.lastTrickWinnerId
								: null,
						playerId,
						roundNumber: state.roundNumber,
						scores: nextState.players.map((player) => ({
							bid: player.bid,
							playerId: player.id,
							roundPoints: player.roundPoints,
							score: player.score,
							tricksWon: player.tricksWon,
						})),
						trickNumber: state.trickNumber,
						value: state.cardValues[payload.cardId],
					})
					ack({ ok: true, roomCode })
				} catch (error) {
					actionFailure(ack, error)
				}
			})

			return () => undefined
		},
	)

	await new Promise<void>((resolve, reject) => {
		httpServer.once("error", reject)
		httpServer.listen(0, "127.0.0.1", resolve)
	})
	const address = httpServer.address() as AddressInfo
	const serverUrl = `http://127.0.0.1:${address.port}`
	const squirrel = new Squirrel(mode, cacheDirectory)
	let generatorCalls = 0
	const runtimes: AiPlayerRuntime[] = []

	try {
		for (const bot of bots) {
			const generateTurn =
				options.createGenerator?.(bot, squirrel) ??
				wrapAiGeneratorWithVarmint(
					`oh-hell-e2e-${bot.modelId}-${bot.id}`,
					bot.modelId,
					async (context) => {
						generatorCalls += 1
						const decision = fallbackAiDecision(context)
						return {
							...decision,
							currentPlan: `${bot.modelId}: ${decision.currentPlan}`,
						}
					},
					squirrel,
				)
			runtimes.push(
				await createAiPlayer({
					generateTurn,
					modelId: bot.modelId,
					name: bot.name,
					playerId: bot.id,
					playerSecret: bot.secret,
					roomCode,
					serverUrl,
				}),
			)
		}

		setState(
			gameStateAtoms,
			roomCode,
			startOhHellGame(currentState(), bots[0].id, dealRandom.next),
		)
		const finalState = structuredClone(
			await waitForGameComplete(dealRandom, options.timeout ?? 20_000),
		)
		const cacheFiles = await readdir(cacheDirectory, { recursive: true })
		return {
			cacheOutputCount: cacheFiles.filter((file) =>
				file.endsWith(".output.json"),
			).length,
			finalState,
			generatorCalls,
			transcript,
		}
	} finally {
		for (const runtime of runtimes) runtime.dispose()
		await new Promise<void>((resolve) => socketServer.close(() => resolve()))
		if (httpServer.listening) {
			await new Promise<void>((resolve) => httpServer.close(() => resolve()))
		}
	}
}

function serializedError(
	error: unknown,
): { message: string; name: string } | string | null {
	if (error instanceof Error) {
		return { message: error.message, name: error.name }
	}
	if (error === undefined) return null
	return String(error)
}

function testLogLevel(): LogLevel {
	const configured = process.env.TEST_LOG_LEVEL
	if (
		configured === "debug" ||
		configured === "info" ||
		configured === "warn" ||
		configured === "error"
	) {
		return configured
	}
	return "error"
}

function createLiveGeneratorFactory(
	apiKey: string,
	decisions: LiveDecisionRecord[],
	modelResponses: LiveModelResponseRecord[],
	fallbacks: LiveFallbackRecord[],
): NonNullable<BotTableOptions["createGenerator"]> {
	return (bot, squirrel) => {
		const generate = createOpenAiTurnGenerator(bot.modelId, apiKey, {
			onFallback: (details) => {
				fallbacks.push({
					error: serializedError(details.error),
					generated: details.generated,
					modelId: bot.modelId,
					prompt: renderAiGameFacts(details.context),
					reason: details.reason,
					sequence: decisions.length + 1,
				})
			},
			onModelResponse: (response) => {
				modelResponses.push({
					...response,
					playerId: bot.id,
					sequence: decisions.length + 1,
				})
			},
			squirrel,
		})
		return async (context) => {
			const responseCount = modelResponses.length
			const fallbackCount = fallbacks.length
			const decision = await generate(context)
			decisions.push({
				decision,
				modelId: bot.modelId,
				playerId: bot.id,
				prompt: renderAiGameFacts(context),
				sequence: decisions.length + 1,
				source:
					fallbacks.length > fallbackCount
						? "fallback"
						: modelResponses.length > responseCount
							? "model"
							: "cache",
			})
			return decision
		}
	}
}

describe("four-bot deterministic realtime Oh Hell game", () => {
	const originalLogLevel = serverLogger.getMinimumLevel()

	beforeAll(() => {
		serverLogger.setMinimumLevel(testLogLevel())
	})

	afterAll(() => {
		serverLogger.setMinimumLevel(originalLogLevel)
	})

	it("records and perfectly replays all five rounds", async () => {
		const cacheDirectory = await mkdtemp(
			join(tmpdir(), "wayfarer-oh-hell-e2e-"),
		)
		try {
			const recorded = await runBotTable("write", cacheDirectory)
			const replayed = await runBotTable("read", cacheDirectory)

			expect(recorded.generatorCalls).toBe(80)
			expect(recorded.cacheOutputCount).toBe(80)
			expect(recorded.transcript).toHaveLength(80)
			const inputFiles = (await readdir(cacheDirectory, { recursive: true }))
				.filter((file) => file.endsWith(".input.json"))
				.map((file) => join(cacheDirectory, file))
			expect(inputFiles).toHaveLength(80)
			for (const inputFile of inputFiles) {
				const input = JSON.parse(await readFile(inputFile, "utf8"))
				expect(input).toEqual([expect.stringContaining("Oh Hell")])
				expect(JSON.stringify(input)).not.toContain("privateView")
				expect(JSON.stringify(input)).not.toContain("card::")
			}
			expect(replayed.generatorCalls).toBe(0)
			expect(replayed.cacheOutputCount).toBe(80)
			expect(replayed.transcript).toEqual(recorded.transcript)
			expect(replayed.finalState).toEqual(recorded.finalState)
			expect(recorded.finalState.roundNumber).toBe(5)
			expect(recorded.finalState.phase).toBe("gameComplete")
		} finally {
			await rm(cacheDirectory, { force: true, recursive: true })
		}
	}, 30_000)

	it("replays the checked-in strategic Sol and Luna game", async () => {
		const cacheDirectory = join(
			process.cwd(),
			".varmint",
			"oh-hell-games",
			"sol-vs-three-luna-live-v1-compact-strategy",
			"cache",
		)
		const decisions: LiveDecisionRecord[] = []
		const modelResponses: LiveModelResponseRecord[] = []
		const fallbacks: LiveFallbackRecord[] = []
		const replayed = await runBotTable("read", cacheDirectory, {
			createGenerator: createLiveGeneratorFactory(
				"cache-only",
				decisions,
				modelResponses,
				fallbacks,
			),
			seed: liveInvariantSeed,
			timeout: 60_000,
		})

		expect(decisions).toHaveLength(80)
		expect(modelResponses).toHaveLength(0)
		expect(fallbacks).toHaveLength(1)
		expect(fallbacks[0]).toMatchObject({
			modelId: "gpt-5.6-luna",
			reason: "illegal_action",
			sequence: 67,
		})
		expect(replayed.cacheOutputCount).toBe(80)
		expect(replayed.finalState.players.map((player) => player.score)).toEqual([
			33, 32, 36, 34,
		])
		expect(replayed.finalState.winnerIds).toEqual([bots[2].id])
	}, 20_000)

	const liveIt =
		process.env.RECORD_LIVE_OH_HELL_AI_GAME === "1" ? it : it.skip

	liveIt(
		"records a real Sol-versus-three-Luna Oh Hell game for analysis",
		async () => {
			const apiKey = process.env.OPENAI_API_KEY
			if (apiKey === undefined || apiKey.length === 0) {
				throw new Error("OPENAI_API_KEY is required for a live recording.")
			}

			const recordingDirectory = join(
				process.cwd(),
				".varmint",
				"oh-hell-games",
				liveRecordingName,
			)
			const cacheDirectory = join(recordingDirectory, "cache")
			const artifactPath = join(recordingDirectory, "analysis.json")
			await mkdir(recordingDirectory, { recursive: true })

			const recordedDecisions: LiveDecisionRecord[] = []
			const recordedResponses: LiveModelResponseRecord[] = []
			const recordedFallbacks: LiveFallbackRecord[] = []
			const recorded = await runBotTable(liveCacheMode, cacheDirectory, {
				createGenerator: createLiveGeneratorFactory(
					apiKey,
					recordedDecisions,
					recordedResponses,
					recordedFallbacks,
				),
				seed: liveInvariantSeed,
				timeout: 1_200_000,
			})

			const replayedDecisions: LiveDecisionRecord[] = []
			const replayedResponses: LiveModelResponseRecord[] = []
			const replayedFallbacks: LiveFallbackRecord[] = []
			const replayed = await runBotTable("read", cacheDirectory, {
				createGenerator: createLiveGeneratorFactory(
					"cache-only",
					replayedDecisions,
					replayedResponses,
					replayedFallbacks,
				),
				seed: liveInvariantSeed,
				timeout: 60_000,
			})

			expect(recorded.cacheOutputCount).toBe(80)
			expect(recorded.transcript).toHaveLength(80)
			expect(recordedDecisions).toHaveLength(80)
			expect(replayedResponses).toHaveLength(0)
			expect(replayedFallbacks).toEqual(recordedFallbacks)
			expect(replayed.transcript).toEqual(recorded.transcript)
			expect(replayed.finalState).toEqual(recorded.finalState)
			expect(replayedDecisions.map(({ decision }) => decision)).toEqual(
				recordedDecisions.map(({ decision }) => decision),
			)

			await writeFile(
				artifactPath,
				`${JSON.stringify(
					{
						cacheDirectory,
						createdAt: new Date().toISOString(),
						models: bots.map(({ id, modelId, name }) => ({
							id,
							modelId,
							name,
						})),
						recordingName: liveRecordingName,
						recording: {
							cacheOutputCount: recorded.cacheOutputCount,
							decisions: recordedDecisions,
							fallbacks: recordedFallbacks,
							finalState: recorded.finalState,
							modelResponses: recordedResponses,
							transcript: recorded.transcript,
						},
						replay: {
							cacheOutputCount: replayed.cacheOutputCount,
							decisions: replayedDecisions,
							fallbacks: replayedFallbacks,
							finalState: replayed.finalState,
							modelResponseCount: replayedResponses.length,
							transcript: replayed.transcript,
						},
						roomCode,
						seed: liveInvariantSeed,
						status: "recorded-and-replayed",
					},
					null,
					2,
				)}\n`,
			)
		},
		1_200_000,
	)
})
