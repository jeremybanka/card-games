import { createServer } from "node:http"
import { mkdtemp, readdir, rm } from "node:fs/promises"
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
import { wrapAiGeneratorWithVarmint } from "./ai-generator.node.ts"
import type { AiModelId } from "./ai-models.ts"
import { fallbackAiDecision, type AiTurnGenerator } from "./ai-strategy.ts"
import {
	parsePassCardsPayload,
	parsePlayCardPayload,
} from "../game/hearts-actions.ts"
import {
	createHeartsGame,
	createPhysicalCardIds,
	joinHeartsGame,
	playCard,
	startGame,
	submitPass,
	type HeartsState,
} from "../game/hearts-engine.ts"
import { createSeededRandom } from "../game/seeded-random.ts"
import {
	heartsStateAtoms,
	privatePlayerViewAtom,
	privatePlayerViewProjectionSelectors,
	publicGameViewAtom,
	publicGameViewProjectionSelectors,
} from "../game/hearts-state.ts"
import type {
	ActionAck,
	CardId,
	ClientToServerEvents,
	PlayerId,
	ServerToClientEvents,
} from "../game/hearts-types.ts"
import { serverLogger } from "../observability/span-logger.node.ts"

const roomCode = "BOTS"
const invariantSeed = "sol-vs-three-luna-v1"
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

type BotSocket = Socket<
	ClientToServerEvents,
	ServerToClientEvents,
	Record<string, never>,
	Record<string, never>
>

type TranscriptEntry =
	| {
			action: "passCards"
			cardIds: CardId[]
			playerId: PlayerId
			roundNumber: number
	  }
	| {
			action: "playCard"
			cardId: CardId
			playerId: PlayerId
			roundNumber: number
			trickNumber: number
			value: HeartsState["cardValues"][CardId]
	  }

type BotRun = {
	cacheOutputCount: number
	finalState: HeartsState
	generatorCalls: number
	transcript: TranscriptEntry[]
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

async function waitForRoundComplete(timeout = 10_000): Promise<HeartsState> {
	const startedAt = Date.now()
	while (true) {
		const state = getState(heartsStateAtoms, roomCode)
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
): Promise<BotRun> {
	const dealRandom = createSeededRandom(`deal:${roomCode}:${invariantSeed}`)
	const identityRandom = createSeededRandom(
		`identity:${roomCode}:${invariantSeed}`,
	)
	const initial = createHeartsGame(
		roomCode,
		bots[0].id,
		bots[0].name,
		createPhysicalCardIds(identityRandom.uuid),
	)
	initial.players[0]!.aiModel = bots[0].modelId
	initial.players[0]!.kind = "ai"
	setState(heartsStateAtoms, roomCode, initial)

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
						heartsStateAtoms,
						roomCode,
						joinHeartsGame(
							getState(heartsStateAtoms, roomCode),
							playerId,
							playerName,
							{ aiModel: bot.modelId, kind: "ai" },
						),
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
					const state = getState(heartsStateAtoms, roomCode)
					const payload = parsePassCardsPayload({ cardIds })
					const nextState = submitPass(state, playerId, payload.cardIds)
					setState(heartsStateAtoms, roomCode, nextState)
					transcript.push({
						action: "passCards",
						cardIds: payload.cardIds,
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
					const state = getState(heartsStateAtoms, roomCode)
					const payload = parsePlayCardPayload({ cardId })
					const nextState = playCard(state, playerId, payload.cardId)
					setState(heartsStateAtoms, roomCode, nextState)
					transcript.push({
						action: "playCard",
						cardId: payload.cardId,
						playerId,
						roundNumber: state.roundNumber,
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
			const modelStrategy: AiTurnGenerator = async (context) => {
				generatorCalls += 1
				const decision = fallbackAiDecision(context)
				return {
					...decision,
					currentPlan: `${bot.modelId}: ${decision.currentPlan}`,
				}
			}
			runtimes.push(
				await createAiPlayer({
					canAct: serialPassingGate(bot.id),
					generateTurn: wrapAiGeneratorWithVarmint(
						`e2e-${bot.modelId}-${bot.id}`,
						modelStrategy,
						squirrel,
					),
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
			heartsStateAtoms,
			roomCode,
			startGame(
				getState(heartsStateAtoms, roomCode),
				bots[0].id,
				dealRandom.next,
			),
		)
		const finalState = structuredClone(await waitForRoundComplete())
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

describe("four-bot deterministic realtime game", () => {
	const originalLogLevel = serverLogger.getMinimumLevel()

	beforeAll(() => {
		serverLogger.setMinimumLevel("error")
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
})
