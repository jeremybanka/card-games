import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { findState, getState, setState } from "atom.io"
import type { UserKey } from "atom.io/realtime"
import type { UserServerConfig } from "atom.io/realtime-server"
import { realtime, realtimeStateProvider } from "atom.io/realtime-server"
import { Server, type Socket } from "socket.io"
import { Squirrel, type CacheMode } from "varmint"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

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
	ClientToServerEvents,
	PlayerId,
	ServerToClientEvents,
} from "../game/game-types.ts"
import {
	type LogLevel,
	serverLogger,
} from "../observability/span-logger.node.ts"
import {
	attackSummoners,
	createSummonersGame,
	createSummonersPhysicalCardIds,
	endSummonersTurn,
	joinSummonersGame,
	playSummonersCard,
	selectSummonersDeck,
	startSummonersGame,
	tendSummoners,
	type SummonersState,
	toSummonersPublicGameView,
	useSummonerPower,
} from "../summoners/summoners-engine.ts"
import { isSummonersDeckId } from "../summoners/summoners-cards.ts"
import type {
	SummonersDeckId,
	SummonersTarget,
} from "../summoners/summoners-types.ts"
import type { AiModelId } from "./ai-models.ts"
import {
	createOpenAiTurnGenerator,
	type AiModelResponseRecord,
} from "./ai-generator.node.ts"
import { createAiPlayer, type AiPlayerRuntime } from "./ai-player.node.ts"
import type { AiFallbackReason, AiTurnGenerator } from "./ai-strategy.ts"

function configuredDeck(
	environmentName: string,
	fallback: SummonersDeckId,
): SummonersDeckId {
	const value = process.env[environmentName]
	if (value === undefined) return fallback
	if (!isSummonersDeckId(value)) {
		throw new Error(`${environmentName} names an unknown Summoners deck.`)
	}
	return value
}

const roomCode = process.env.SUMMONERS_AI_ROOM_CODE ?? "LUNA"
const invariantSeed =
	process.env.SUMMONERS_AI_SEED ?? "summoners-luna-vs-luna-v1"
const liveRecordingName =
	process.env.SUMMONERS_AI_RECORDING_NAME ?? "luna-vs-luna-live-v1"
const matchupDecks = [
	configuredDeck("SUMMONERS_AI_DECK_A", "emberReliquary"),
	configuredDeck("SUMMONERS_AI_DECK_B", "verdantCompact"),
] as const
const recordsLiveGame = process.env.RECORD_LIVE_SUMMONERS_AI_GAME === "1"
const recordsIncrementally =
	process.env.SUMMONERS_AI_INCREMENTAL_RECORDING === "1"
const bots = [
	{
		id: "user::00000000-0000-4000-8000-0000000000a1",
		modelId: "gpt-5.6-luna",
		name: process.env.SUMMONERS_AI_NAME_A ?? "Luna Ember",
		secret: "10000000-0000-4000-8000-0000000000a1",
	},
	{
		id: "user::00000000-0000-4000-8000-0000000000b2",
		modelId: "gpt-5.6-luna",
		name: process.env.SUMMONERS_AI_NAME_B ?? "Luna Verdant",
		secret: "10000000-0000-4000-8000-0000000000b2",
	},
] as const satisfies readonly {
	id: PlayerId
	modelId: AiModelId
	name: string
	secret: string
}[]

type BotSocket = Socket<
	ClientToServerEvents,
	ServerToClientEvents,
	Record<string, never>,
	Record<string, never>
>

type TranscriptEntry = {
	action:
		| "attackSummoners"
		| "endSummonersTurn"
		| "playSummonersCard"
		| "selectSummonersDeck"
		| "tendSummoners"
		| "useSummonerPower"
	playerId: PlayerId
	turnNumber: number
}

type FallbackRecord = {
	error: string | null
	generated: unknown
	modelId: AiModelId
	playerId: PlayerId
	reason: AiFallbackReason
	turnNumber: number
}

type DecisionObservation = {
	ledgerLength: number
	playerId: PlayerId
	previousPlan: string
	revision: number
	turnNumber: number
}

function actionFailure(ack: ActionAck, error: unknown): void {
	ack({
		error: error instanceof Error ? error.message : "Action failed.",
		ok: false,
	})
}

function currentState(): SummonersState {
	const state = getState(gameStateAtoms, roomCode)
	if (state.gameKind !== "summoners") {
		throw new Error("Expected a Summoners table.")
	}
	return state
}

async function waitFor(
	predicate: (state: SummonersState) => boolean,
	timeout: number,
): Promise<SummonersState> {
	const startedAt = Date.now()
	while (true) {
		const state = currentState()
		if (predicate(state)) return state
		if (Date.now() - startedAt > timeout) {
			throw new Error(
				`The Luna match timed out: ${JSON.stringify({
					currentPlayerId: state.currentPlayerId,
					phase: state.phase,
					players: state.players.map((player) => ({
						battlefield: player.battlefield.length,
						deck: player.deck.length,
						deckId: player.deckId,
						hand: player.hand.length,
						health: player.health,
						id: player.id,
						spark: player.spark,
					})),
					turnNumber: state.turnNumber,
				})}`,
			)
		}
		await new Promise((resolve) => setTimeout(resolve, 5))
	}
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

describe("two-Luna deterministic realtime Summoners game", () => {
	const originalLogLevel = serverLogger.getMinimumLevel()

	beforeAll(() => {
		serverLogger.setMinimumLevel(testLogLevel())
	})

	afterAll(() => {
		serverLogger.setMinimumLevel(originalLogLevel)
	})

	it(
		"plays from deck choice through a decisive Conclave",
		async () => {
			const apiKey = recordsLiveGame ? process.env.OPENAI_API_KEY : "cache-only"
			if (apiKey === undefined || apiKey.length === 0) {
				throw new Error("OPENAI_API_KEY is required for a live recording.")
			}
			const recordingDirectory = join(
				process.cwd(),
				".varmint",
				"summoners-games",
				liveRecordingName,
			)
			const cacheDirectory = join(recordingDirectory, "cache")
			const cacheMode: CacheMode = recordsLiveGame
				? recordsIncrementally
					? "read-write"
					: "write"
				: "read"
			const squirrel = new Squirrel(cacheMode, cacheDirectory)
			const dealRandom = createSeededRandom(`deal:${roomCode}:${invariantSeed}`)
			const identityRandom = createSeededRandom(
				`identity:${roomCode}:${invariantSeed}`,
			)
			const initial = createSummonersGame(
				roomCode,
				bots[0].id,
				bots[0].name,
				createSummonersPhysicalCardIds(identityRandom.uuid),
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
					const bot = bots.find(
						(candidate) =>
							candidate.id === `user::${String(handshake.auth.playerId)}` &&
							candidate.secret === handshake.auth.playerSecret,
					)
					return bot === undefined
						? new Error("Unknown deterministic Luna identity.")
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
								throw new Error("Unknown deterministic Summoners room.")
							}
							setState(
								gameStateAtoms,
								roomCode,
								joinSummonersGame(currentState(), playerId, playerName, {
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

					socket.on("selectSummonersDeck", (deckId, ack) => {
						try {
							const state = currentState()
							setState(
								gameStateAtoms,
								roomCode,
								selectSummonersDeck(state, playerId, deckId as SummonersDeckId),
							)
							transcript.push({
								action: "selectSummonersDeck",
								playerId,
								turnNumber: state.turnNumber,
							})
							ack({ ok: true, roomCode })
						} catch (error) {
							actionFailure(ack, error)
						}
					})

					socket.on("playSummonersCard", (cardId, target, ack) => {
						try {
							const state = currentState()
							setState(
								gameStateAtoms,
								roomCode,
								playSummonersCard(
									state,
									playerId,
									cardId,
									target as SummonersTarget | null,
								),
							)
							transcript.push({
								action: "playSummonersCard",
								playerId,
								turnNumber: state.turnNumber,
							})
							ack({ ok: true, roomCode })
						} catch (error) {
							actionFailure(ack, error)
						}
					})

					socket.on("attackSummoners", (attackerId, target, ack) => {
						try {
							const state = currentState()
							setState(
								gameStateAtoms,
								roomCode,
								attackSummoners(
									state,
									playerId,
									attackerId,
									target as SummonersTarget,
								),
							)
							transcript.push({
								action: "attackSummoners",
								playerId,
								turnNumber: state.turnNumber,
							})
							ack({ ok: true, roomCode })
						} catch (error) {
							actionFailure(ack, error)
						}
					})

					socket.on("useSummonerPower", (target, ack) => {
						try {
							const state = currentState()
							setState(
								gameStateAtoms,
								roomCode,
								useSummonerPower(
									state,
									playerId,
									target as SummonersTarget | null,
								),
							)
							transcript.push({
								action: "useSummonerPower",
								playerId,
								turnNumber: state.turnNumber,
							})
							ack({ ok: true, roomCode })
						} catch (error) {
							actionFailure(ack, error)
						}
					})

					socket.on("tendSummoners", (tenderId, targetId, ack) => {
						try {
							const state = currentState()
							setState(
								gameStateAtoms,
								roomCode,
								tendSummoners(state, playerId, tenderId, targetId),
							)
							transcript.push({
								action: "tendSummoners",
								playerId,
								turnNumber: state.turnNumber,
							})
							ack({ ok: true, roomCode })
						} catch (error) {
							actionFailure(ack, error)
						}
					})

					socket.on("endSummonersTurn", (ack) => {
						try {
							const state = currentState()
							setState(
								gameStateAtoms,
								roomCode,
								endSummonersTurn(state, playerId),
							)
							transcript.push({
								action: "endSummonersTurn",
								playerId,
								turnNumber: state.turnNumber,
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
			const runtimes: AiPlayerRuntime[] = []
			const generatorCalls = new Map<PlayerId, number>()
			const modelResponses: AiModelResponseRecord[] = []
			const fallbacks: FallbackRecord[] = []
			const decisionObservations: DecisionObservation[] = []

			try {
				for (const bot of bots) {
					const modelGenerator = createOpenAiTurnGenerator(
						bot.modelId,
						apiKey,
						{
							onFallback: ({ context, error, generated, reason }) => {
								fallbacks.push({
									error: error instanceof Error ? error.message : null,
									generated,
									modelId: bot.modelId,
									playerId: bot.id,
									reason,
									turnNumber:
										context.publicView.gameKind === "summoners"
											? context.publicView.turnNumber
											: 0,
								})
							},
							onModelResponse: (response) => modelResponses.push(response),
							squirrel,
						},
					)
					const generateTurn: AiTurnGenerator = async (context) => {
						generatorCalls.set(bot.id, (generatorCalls.get(bot.id) ?? 0) + 1)
						if (context.publicView.gameKind === "summoners") {
							decisionObservations.push({
								ledgerLength: context.summonersTurnLedger?.length ?? 0,
								playerId: bot.id,
								previousPlan: context.previousPlan,
								revision: context.publicView.revision,
								turnNumber: context.publicView.turnNumber,
							})
						}
						return modelGenerator(context)
					}
					runtimes.push(
						await createAiPlayer({
							canAct: (game) => game.phase !== "lobby",
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

				const seated = await waitFor(
					(state) => state.players.length === 2,
					5_000,
				)
				let ready = selectSummonersDeck(seated, bots[0].id, matchupDecks[0])
				transcript.push({
					action: "selectSummonersDeck",
					playerId: bots[0].id,
					turnNumber: ready.turnNumber,
				})
				ready = selectSummonersDeck(ready, bots[1].id, matchupDecks[1])
				transcript.push({
					action: "selectSummonersDeck",
					playerId: bots[1].id,
					turnNumber: ready.turnNumber,
				})
				setState(gameStateAtoms, roomCode, ready)
				expect(ready.players.map((player) => player.kind)).toEqual(["ai", "ai"])
				expect(ready.players.map((player) => player.aiModel)).toEqual([
					"gpt-5.6-luna",
					"gpt-5.6-luna",
				])

				setState(
					gameStateAtoms,
					roomCode,
					startSummonersGame(ready, bots[0].id, dealRandom.next),
				)
				const finalState = await waitFor(
					(state) => state.phase === "gameComplete",
					recordsLiveGame ? 1_100_000 : 20_000,
				)

				expect(finalState.winnerIds).toHaveLength(1)
				expect(finalState.players.map((player) => player.kind)).toEqual([
					"ai",
					"ai",
				])
				expect(new Set(transcript.map((entry) => entry.playerId))).toEqual(
					new Set(bots.map((bot) => bot.id)),
				)
				expect(
					transcript.some((entry) => entry.action === "playSummonersCard"),
				).toBe(true)
				expect(
					transcript.some((entry) => entry.action === "attackSummoners"),
				).toBe(true)
				const actionsPerInvocation = new Map<string, number>()
				for (const entry of transcript) {
					if (entry.action === "selectSummonersDeck") continue
					const key = `${entry.playerId}:${entry.turnNumber}`
					actionsPerInvocation.set(
						key,
						(actionsPerInvocation.get(key) ?? 0) + 1,
					)
				}
				expect(
					[...actionsPerInvocation.values()].some((count) => count > 1),
				).toBe(true)
				const observationsByInvocation = Map.groupBy(
					decisionObservations,
					(observation) => `${observation.playerId}:${observation.turnNumber}`,
				)
				for (const observations of observationsByInvocation.values()) {
					const ordered = observations.toSorted(
						(left, right) => left.revision - right.revision,
					)
					expect(ordered[0]).toMatchObject({
						ledgerLength: 0,
						previousPlan: "",
					})
					for (const [index, observation] of ordered.entries()) {
						expect(observation.ledgerLength).toBe(index)
						if (index > 0)
							expect(observation.previousPlan.length).toBeGreaterThan(0)
					}
				}
				expect(generatorCalls.get(bots[0].id)).toBeGreaterThan(1)
				expect(generatorCalls.get(bots[1].id)).toBeGreaterThan(1)
				expect(
					fallbacks.every(({ reason }) => reason !== "generation_error"),
				).toBe(true)
				squirrel.flush()
				if (recordsLiveGame) {
					await mkdir(recordingDirectory, { recursive: true })
					await writeFile(
						join(recordingDirectory, "analysis.json"),
						`${JSON.stringify(
							{
								cacheDirectory,
								createdAt: new Date().toISOString(),
								decks: matchupDecks,
								decisionObservations,
								fallbacks,
								finalState: toSummonersPublicGameView(finalState),
								modelResponses,
								models: bots,
								roomCode,
								seed: invariantSeed,
								transcript,
							},
							null,
							2,
						)}\n`,
					)
					expect(modelResponses.length).toBeGreaterThan(0)
				} else {
					expect(modelResponses).toHaveLength(0)
				}
			} finally {
				for (const runtime of runtimes) runtime.dispose()
				await new Promise<void>((resolve) =>
					socketServer.close(() => resolve()),
				)
				if (httpServer.listening) {
					await new Promise<void>((resolve) =>
						httpServer.close(() => resolve()),
					)
				}
			}
		},
		recordsLiveGame ? 1_200_000 : 30_000,
	)
})
