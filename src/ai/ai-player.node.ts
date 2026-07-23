import { Silo } from "atom.io"
import type { Socket as RealtimeSocket } from "atom.io/realtime"
import { pullAtom } from "atom.io/realtime-client"
import { io, type Socket } from "socket.io-client"

import {
	privatePlayerViewAtom,
	publicGameViewAtom,
} from "../game/hearts-state.ts"
import type {
	ActionResult,
	CardId,
	ClientToServerEvents,
	PlayerId,
	PrivatePlayerView,
	PublicGameView,
	ServerToClientEvents,
} from "../game/hearts-types.ts"
import { createOpenAiTurnGenerator } from "./ai-generator.node.ts"
import type { AiModelId } from "./ai-models.ts"
import {
	createAiPlayerSiloState,
	type AiPlayerSiloState,
} from "./ai-player-state.node.ts"

type AiSocket = Socket<ServerToClientEvents, ClientToServerEvents>

export type AiPlayerRuntime = {
	dispose: () => void
	modelId: AiModelId
	playerId: PlayerId
	silo: Silo
	state: AiPlayerSiloState
}

export type CreateAiPlayerOptions = {
	modelId: AiModelId
	name: string
	playerId: PlayerId
	playerSecret: string
	roomCode: string
	serverUrl: string
}

function actionResult(
	socket: AiSocket,
	event: "passCards" | "playCard",
	payload: CardId | CardId[],
): Promise<ActionResult> {
	return new Promise((resolve) => {
		if (event === "passCards") {
			socket.emit("passCards", payload as CardId[], resolve)
			return
		}
		socket.emit("playCard", payload as CardId, resolve)
	})
}

export function isAiTurnReady(
	playerId: PlayerId,
	game: PublicGameView,
	privateView: PrivatePlayerView,
): boolean {
	if (privateView.playerId !== playerId) return false
	if (game.phase === "passing") {
		return !privateView.passSubmitted && privateView.cards.length >= 3
	}
	return (
		game.phase === "playing" &&
		game.currentPlayerId === playerId &&
		privateView.playableCardIds.length > 0
	)
}

export async function createAiPlayer(
	options: CreateAiPlayerOptions,
): Promise<AiPlayerRuntime> {
	const silo = new Silo({
		isProduction: process.env.NODE_ENV === "production",
		lifespan: "ephemeral",
		name: `AI-${options.playerId}`,
	})
	const state = createAiPlayerSiloState(
		silo,
		options.playerId,
		createOpenAiTurnGenerator(options.modelId),
	)
	const socket: AiSocket = io(options.serverUrl, {
		autoConnect: false,
		auth: {
			playerId: options.playerId.replace(/^user::/, ""),
			playerSecret: options.playerSecret,
		},
		reconnection: true,
	})

	let disposed = false
	let acting = false
	let lastAttemptedFingerprint = ""
	let pullDisposers: Array<() => void> = []

	const turnFingerprint = (): string => {
		const game = silo.getState(publicGameViewAtom)
		const privateView = silo.getState(privatePlayerViewAtom)
		return JSON.stringify({
			currentPlayerId: game.currentPlayerId,
			currentTrick: game.currentTrick,
			handCardIds: privateView.cards.map((card) => card.id),
			passSubmitted: privateView.passSubmitted,
			phase: game.phase,
			roundNumber: game.roundNumber,
			trickNumber: game.trickNumber,
		})
	}

	const shouldAct = (): boolean => {
		const game = silo.getState(publicGameViewAtom)
		const privateView = silo.getState(privatePlayerViewAtom)
		return isAiTurnReady(options.playerId, game, privateView)
	}

	const act = async (): Promise<void> => {
		if (disposed || acting || !shouldAct()) return
		const fingerprint = turnFingerprint()
		if (fingerprint === lastAttemptedFingerprint) return
		lastAttemptedFingerprint = fingerprint
		acting = true
		try {
			const decision = await silo.getState(state.aiStrategicTurnSelector)
			if (!shouldAct() || turnFingerprint() !== fingerprint) return

			const turnKey = `round-${silo.getState(publicGameViewAtom).roundNumber}-trick-${silo.getState(publicGameViewAtom).trickNumber}`
			silo.setState(state.aiCurrentPlanAtom, decision.currentPlan)
			silo.setState(state.aiNextActionAtom, decision.nextAction)
			silo.setState(state.aiTurnObservationsAtom, (observations) => [
				...observations.slice(-23),
				{ observation: decision.observation, turnKey },
			])

			const result =
				decision.nextAction.action === "passCards"
					? await actionResult(socket, "passCards", decision.nextAction.cardIds)
					: await actionResult(socket, "playCard", decision.nextAction.cardId)
			if (!result.ok) lastAttemptedFingerprint = ""
		} finally {
			acting = false
			if (shouldAct()) queueMicrotask(() => void act())
		}
	}

	const scheduleAct = (): void => {
		queueMicrotask(() => void act())
	}
	const stateDisposers = [
		silo.subscribe(publicGameViewAtom, scheduleAct),
		silo.subscribe(privatePlayerViewAtom, scheduleAct),
	]

	const joinAndPull = (): Promise<void> =>
		new Promise((resolve, reject) => {
			socket.emit("joinRoom", options.roomCode, options.name, (result) => {
				if (!result.ok) {
					reject(new Error(result.error))
					return
				}
				for (const dispose of pullDisposers) dispose()
				pullDisposers = [
					pullAtom(
						silo.store,
						socket as unknown as RealtimeSocket,
						publicGameViewAtom,
					),
					pullAtom(
						silo.store,
						socket as unknown as RealtimeSocket,
						privatePlayerViewAtom,
					),
				]
				resolve()
			})
		})

	let readySettled = false
	const ready = new Promise<void>((resolve, reject) => {
		socket.on("connect", () => {
			void joinAndPull()
				.then(() => {
					if (!readySettled) {
						readySettled = true
						resolve()
					}
				})
				.catch((error: unknown) => {
					if (!readySettled) {
						readySettled = true
						reject(error)
					}
				})
		})
		socket.on("connect_error", (error) => {
			if (!readySettled) {
				readySettled = true
				reject(error)
			}
		})
	})
	socket.connect()
	await ready

	return {
		dispose: () => {
			disposed = true
			for (const dispose of pullDisposers) dispose()
			for (const dispose of stateDisposers) dispose()
			socket.disconnect()
		},
		modelId: options.modelId,
		playerId: options.playerId,
		silo,
		state,
	}
}
