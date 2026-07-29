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
import { Server } from "socket.io"
import type { Socket } from "socket.io"
import type { CacheMode } from "varmint"
import { Squirrel } from "varmint"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createAiPlayer, type AiPlayerRuntime } from "./ai-player.node.ts"
import {
	createOpenAiTurnGenerator,
	type AiModelResponseRecord,
	wrapAiGeneratorWithVarmint,
} from "./ai-generator.node.ts"
import { renderAiGameFacts, type AiGameContext } from "./ai-game-facts.ts"
import type { AiModelId } from "./ai-models.ts"
import {
	fallbackAiDecision,
	type AiFallbackReason,
	type AiTurnGenerator,
} from "./ai-strategy.ts"
import type { AiTurnDecision } from "./ai-types.ts"
import { parsePlayCardPayload } from "../game/game-actions.ts"
import { parsePassCardsPayload } from "../game/hearts-actions.ts"
import { createPhysicalCardIds } from "../game/standard-deck-domain.ts"
import {
	createHeartsGame,
	joinHeartsGame,
	playHeartsCard,
	startHeartsGame,
	submitPass,
	type HeartsState,
} from "../game/hearts-engine.ts"
import { createSeededRandom } from "../game/seeded-random.ts"
import {
	gameStateAtoms,
	privatePlayerViewAtom,
	privatePlayerViewProjectionSelectors,
	publicGameViewAtom,
	publicGameViewProjectionSelectors,
} from "../game/game-state-atoms.ts"
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

const roomCode = "BOTS"
const invariantSeed = "sol-vs-three-luna-v1"
const liveInvariantSeed = "sol-vs-three-luna-live-v1"
const liveRecordingName =
	process.env.AI_GAME_RECORDING_NAME?.trim() ||
	"sol-vs-three-luna-live-v5-labeled-choices"
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
			action: "passCards"
			cards: Array<{
				id: CardId
				value: HeartsState["cardValues"][CardId]
			}>
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
				playerId: PlayerId
				roundPoints: number
				score: number
			}>
			trickNumber: number
			value: HeartsState["cardValues"][CardId]
	  }

type BotRun = {
	cacheOutputCount: number
	finalState: HeartsState
	generatorContexts: AiGameContext[]
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

function serialPassingGate(
	playerId: PlayerId,
): NonNullable<Parameters<typeof createAiPlayer>[0]["canAct"]> {
	return (game) => {
		if (game.phase !== "passing") return true
		const nextPassingPlayer = game.players.find(
			(player) => !game.passSubmittedPlayerIds.includes(player.id),
		)
		return nextPassingPlayer?.id === playerId
	}
}

function currentHeartsState(): HeartsState {
	const state = getState(gameStateAtoms, roomCode)
	if (state.gameKind !== "hearts") throw new Error("Expected a Hearts table.")
	return state
}

async function waitForRoundComplete(timeout = 10_000): Promise<HeartsState> {
	const startedAt = Date.now()
	while (true) {
		const state = currentHeartsState()
		if (state.phase === "roundComplete" || state.phase === "gameComplete") {
			return state
		}
		if (Date.now() - startedAt > timeout) {
			throw new Error(
				`The four-bot round did not complete: ${JSON.stringify({
					currentPlayerId: state.currentPlayerId,
					phase: state.phase,
					players: state.players.map((player) => ({
						handSize: player.hand.length,
						id: player.id,
						passSubmitted: player.passSelection !== null,
					})),
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
	const initial = createHeartsGame(
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
						joinHeartsGame(currentHeartsState(), playerId, playerName, {
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

			socket.on("passCards", (cardIds, ack) => {
				try {
					const state = currentHeartsState()
					const payload = parsePassCardsPayload({ cardIds })
					const nextState = submitPass(state, playerId, payload.cardIds)
					setState(gameStateAtoms, roomCode, nextState)
					transcript.push({
						action: "passCards",
						cards: payload.cardIds.map((id) => ({
							id,
							value: state.cardValues[id],
						})),
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
					const state = currentHeartsState()
					const payload = parsePlayCardPayload({ cardId })
					const nextState = playHeartsCard(state, playerId, payload.cardId)
					setState(gameStateAtoms, roomCode, nextState)
					transcript.push({
						action: "playCard",
						cardId: payload.cardId,
						completedTrickWinnerId:
							nextState.trickNumber > state.trickNumber
								? nextState.lastTrickWinnerId
								: null,
						playerId,
						roundNumber: state.roundNumber,
						scores: nextState.players.map((player) => ({
							playerId: player.id,
							roundPoints: player.roundPoints,
							score: player.score,
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
	const generatorContexts: AiGameContext[] = []
	const runtimes: AiPlayerRuntime[] = []

	try {
		for (const bot of bots) {
			const generateTurn =
				options.createGenerator?.(bot, squirrel) ??
				wrapAiGeneratorWithVarmint(
					`e2e-${bot.modelId}-${bot.id}`,
					async (context) => {
						generatorCalls += 1
						generatorContexts.push(structuredClone(context))
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
					canAct: serialPassingGate(bot.id),
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
			startHeartsGame(currentHeartsState(), bots[0].id, dealRandom.next),
		)
		const finalState = structuredClone(
			await waitForRoundComplete(options.timeout),
		)
		const cacheFiles = await readdir(cacheDirectory, { recursive: true })
		return {
			cacheOutputCount: cacheFiles.filter((file) =>
				file.endsWith(".output.json"),
			).length,
			finalState,
			generatorContexts,
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

describe("four-bot deterministic realtime game", () => {
	const originalLogLevel = serverLogger.getMinimumLevel()

	beforeAll(() => {
		serverLogger.setMinimumLevel(testLogLevel())
	})

	afterAll(() => {
		serverLogger.setMinimumLevel(originalLogLevel)
	})

	it("records and perfectly replays Sol against three Luna bots", async () => {
		const cacheDirectory = await mkdtemp(join(tmpdir(), "wayfarer-bot-e2e-"))
		try {
			const recorded = await runBotTable("write", cacheDirectory)
			const replayed = await runBotTable("read", cacheDirectory)

			expect(recorded.generatorCalls).toBe(56)
			expect(recorded.cacheOutputCount).toBe(56)
			expect(recorded.transcript).toHaveLength(56)
			const inputFiles = (await readdir(cacheDirectory, { recursive: true }))
				.filter((file) => file.endsWith(".input.json"))
				.map((file) => join(cacheDirectory, file))
			expect(inputFiles).toHaveLength(56)
			for (const inputFile of inputFiles) {
				const input = JSON.parse(await readFile(inputFile, "utf8"))
				expect(input).toEqual([expect.stringContaining("Your hand:")])
				expect(JSON.stringify(input)).not.toContain("privateView")
				expect(JSON.stringify(input)).not.toContain("card::")
			}
			expect(
				recorded.generatorContexts
					.filter((context) => context.publicView.phase === "playing")
					.every((context) => context.memoryLedger.length === 2),
			).toBe(true)
			expect(
				Math.max(
					...recorded.generatorContexts.map(
						(context) => context.publicView.completedTricks.length,
					),
				),
			).toBe(12)
			expect(replayed.generatorCalls).toBe(0)
			expect(replayed.cacheOutputCount).toBe(56)
			expect(replayed.transcript).toEqual(recorded.transcript)
			expect(replayed.finalState).toEqual(recorded.finalState)
			expect(
				recorded.finalState.players.map((player) => player.aiModel),
			).toEqual(["gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.6-luna", "gpt-5.6-luna"])
		} finally {
			await rm(cacheDirectory, { force: true, recursive: true })
		}
	}, 20_000)

	it("replays the checked-in strategic Sol and Luna fixture", async () => {
		const cacheDirectory = join(
			process.cwd(),
			".varmint",
			"recordings",
			"sol-vs-three-luna-live-v5-labeled-choices",
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
		})

		expect(decisions).toHaveLength(56)
		expect(decisions.every((decision) => decision.source === "cache")).toBe(
			true,
		)
		expect(modelResponses).toHaveLength(0)
		expect(fallbacks).toHaveLength(0)
		expect(replayed.cacheOutputCount).toBe(56)
		expect(
			replayed.finalState.players.map((player) => player.roundPoints),
		).toEqual([4, 0, 3, 19])
	}, 20_000)

	const liveIt = process.env.RECORD_LIVE_AI_GAME === "1" ? it : it.skip

	liveIt(
		"records a real Sol-versus-three-Luna round for analysis",
		async () => {
			const apiKey = process.env.OPENAI_API_KEY
			if (apiKey === undefined || apiKey.length === 0) {
				throw new Error("OPENAI_API_KEY is required for a live recording.")
			}

			const recordingDirectory = join(
				process.cwd(),
				".varmint",
				"recordings",
				liveRecordingName,
			)
			const cacheDirectory = join(recordingDirectory, "cache")
			const artifactPath = join(recordingDirectory, "analysis.json")
			await mkdir(recordingDirectory, { recursive: true })

			const recordedDecisions: LiveDecisionRecord[] = []
			const recordedResponses: LiveModelResponseRecord[] = []
			const recordedFallbacks: LiveFallbackRecord[] = []
			const recorded = await runBotTable("write", cacheDirectory, {
				createGenerator: createLiveGeneratorFactory(
					apiKey,
					recordedDecisions,
					recordedResponses,
					recordedFallbacks,
				),
				seed: liveInvariantSeed,
				timeout: 1_200_000,
			})

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
						roomCode,
						seed: liveInvariantSeed,
						status: "recorded",
					},
					null,
					2,
				)}\n`,
			)

			const replayedDecisions: LiveDecisionRecord[] = []
			const replayedResponses: LiveModelResponseRecord[] = []
			const replayedFallbacks: LiveFallbackRecord[] = []
			const replayed = await runBotTable("read", cacheDirectory, {
				createGenerator: createLiveGeneratorFactory(
					apiKey,
					replayedDecisions,
					replayedResponses,
					replayedFallbacks,
				),
				seed: liveInvariantSeed,
				timeout: 60_000,
			})

			expect(recorded.cacheOutputCount).toBe(56)
			expect(recorded.transcript).toHaveLength(56)
			expect(recordedDecisions).toHaveLength(56)
			expect(replayedResponses).toHaveLength(0)
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
