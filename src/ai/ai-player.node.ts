import { createHash, randomUUID } from "node:crypto"

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
	AiStrategyReviewAction,
	AiStrategyReviewTurn,
	CardId,
	ClientToServerEvents,
	PassDirection,
	PlayerId,
	PrivatePlayerView,
	PublicGameView,
	ServerToClientEvents,
	VisibleCard,
} from "../game/hearts-types.ts"
import { serverLogger } from "../observability/span-logger.node.ts"
import { createOpenAiTurnGenerator } from "./ai-generator.node.ts"
import type { AiModelId } from "./ai-models.ts"
import type { AiTurnGenerator } from "./ai-strategy.ts"
import type { AiMemoryLedgerEntry, AiNextAction } from "./ai-types.ts"
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
	canAct?: (game: PublicGameView, privateView: PrivatePlayerView) => boolean
	generateTurn?: AiTurnGenerator
	modelId: AiModelId
	name: string
	playerId: PlayerId
	playerSecret: string
	roomCode: string
	serverUrl: string
}

function passSeatOffset(direction: PassDirection, playerCount: number): number {
	switch (direction) {
		case "left":
			return 1
		case "right":
			return -1
		case "across":
			return playerCount === 4 ? 2 : 1
		case "hold":
			return 0
	}
}

function passPartnerId(
	game: PublicGameView,
	playerId: PlayerId,
	role: "recipient" | "sender",
): PlayerId {
	const playerIndex = game.players.findIndex((player) => player.id === playerId)
	if (playerIndex === -1) {
		throw new Error("The AI player is not seated at its realtime table.")
	}
	const offset = passSeatOffset(game.passDirection, game.players.length)
	const directedOffset = role === "recipient" ? offset : -offset
	const partnerIndex =
		(playerIndex + directedOffset + game.players.length) % game.players.length
	return (game.players[partnerIndex] as PublicGameView["players"][number]).id
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

async function createAiPlayerRuntime(
	options: CreateAiPlayerOptions,
): Promise<AiPlayerRuntime> {
	const silo = new Silo({
		isProduction: process.env.NODE_ENV === "production",
		lifespan: "ephemeral",
		name: `AI-${options.playerId}-${randomUUID()}`,
	})
	const state = createAiPlayerSiloState(
		silo,
		options.playerId,
		options.generateTurn ?? createOpenAiTurnGenerator(options.modelId),
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
	let observedRoundNumber = 0
	let pullDisposers: Array<() => void> = []
	let pendingPass:
		| {
				direction: PassDirection
				handBeforePass: VisibleCard[]
				passedCards: VisibleCard[]
				roundNumber: number
				senderId: PlayerId
		  }
		| undefined

	const appendMemory = (entry: AiMemoryLedgerEntry): void => {
		silo.setState(state.aiMemoryLedgerAtom, (ledger) => [...ledger, entry])
	}

	const resetMemoryForNewRound = (): void => {
		const roundNumber = silo.getState(publicGameViewAtom).roundNumber
		if (roundNumber === observedRoundNumber) return
		observedRoundNumber = roundNumber
		pendingPass = undefined
		lastAttemptedFingerprint = ""
		silo.setState(state.aiMemoryLedgerAtom, [])
		silo.setState(state.aiStrategyReviewTurnsAtom, [])
		silo.setState(state.aiTurnObservationsAtom, [])
		silo.setState(state.aiCurrentPlanAtom, "")
		silo.setState(state.aiNextActionAtom, null)
	}

	const captureReceivedPassCards = (): void => {
		if (pendingPass === undefined) return
		const privateView = silo.getState(privatePlayerViewAtom)
		const passedIds = new Set(pendingPass.passedCards.map((card) => card.id))
		if (privateView.cards.some((card) => passedIds.has(card.id))) return
		const retainedIds = new Set(
			pendingPass.handBeforePass
				.filter((card) => !passedIds.has(card.id))
				.map((card) => card.id),
		)
		const receivedCards = privateView.cards.filter(
			(card) => !retainedIds.has(card.id),
		)
		if (receivedCards.length !== pendingPass.passedCards.length) return
		appendMemory({
			cards: receivedCards,
			direction: pendingPass.direction,
			kind: "cardsReceived",
			roundNumber: pendingPass.roundNumber,
			senderId: pendingPass.senderId,
		})
		pendingPass = undefined
	}

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
	const fingerprintId = (fingerprint: string): string =>
		createHash("sha256").update(fingerprint).digest("hex").slice(0, 12)

	const strategyReviewAction = (
		action: AiNextAction,
		privateView: PrivatePlayerView,
	): AiStrategyReviewAction => {
		if (action.action === "passCards") {
			const selectedIds = new Set(action.cardIds)
			return {
				cards: privateView.cards
					.filter((card) => selectedIds.has(card.id))
					.map(({ rank, suit }) => ({ rank, suit })),
				kind: "passCards",
			}
		}
		const playedCard = privateView.cards.find(
			(card) => card.id === action.cardId,
		)
		if (playedCard === undefined) {
			throw new Error("The AI review could not resolve its played card.")
		}
		return {
			card: { rank: playedCard.rank, suit: playedCard.suit },
			kind: "playCard",
		}
	}

	const shouldAct = (): boolean => {
		const game = silo.getState(publicGameViewAtom)
		const privateView = silo.getState(privatePlayerViewAtom)
		return (
			isAiTurnReady(options.playerId, game, privateView) &&
			(options.canAct?.(game, privateView) ?? true)
		)
	}

	const act = async (): Promise<void> => {
		if (disposed || acting || !shouldAct()) return
		const fingerprint = turnFingerprint()
		if (fingerprint === lastAttemptedFingerprint) return
		lastAttemptedFingerprint = fingerprint
		acting = true
		try {
			const gameAtStart = silo.getState(publicGameViewAtom)
			const privateViewAtStart = silo.getState(privatePlayerViewAtom)
			await serverLogger.withRootSpan(
				"ai.turn",
				{
					fingerprintId: fingerprintId(fingerprint),
					modelId: options.modelId,
					playerId: options.playerId,
					privateView: privateViewAtStart,
					publicView: gameAtStart,
					roomCode: options.roomCode,
				},
				async (span) => {
					const decision = await silo.getState(state.aiStrategicTurnSelector)
					if (!shouldAct() || turnFingerprint() !== fingerprint) {
						span.event(
							"ai.turn.abandoned",
							{
								currentFingerprintId: fingerprintId(turnFingerprint()),
								decision,
								reason: "authoritative_state_changed",
							},
							"warn",
						)
						return
					}

					const currentGame = silo.getState(publicGameViewAtom)
					const turnKey = `round-${currentGame.roundNumber}-trick-${currentGame.trickNumber}`
					silo.setState(state.aiCurrentPlanAtom, decision.currentPlan)
					silo.setState(state.aiNextActionAtom, decision.nextAction)
					silo.setState(state.aiTurnObservationsAtom, (observations) => [
						...observations.slice(-23),
						{ observation: decision.observation, turnKey },
					])
					span.event("ai.state.updated", {
						currentPlan: decision.currentPlan,
						nextAction: decision.nextAction,
						observation: decision.observation,
						observationJournal: silo.getState(state.aiTurnObservationsAtom),
						turnKey,
					})

					const result =
						decision.nextAction.action === "passCards"
							? await actionResult(
									socket,
									"passCards",
									decision.nextAction.cardIds,
								)
							: await actionResult(
									socket,
									"playCard",
									decision.nextAction.cardId,
								)
					if (result.ok && decision.nextAction.action === "passCards") {
						const selectedIds = new Set(decision.nextAction.cardIds)
						const passedCards = privateViewAtStart.cards.filter((card) =>
							selectedIds.has(card.id),
						)
						pendingPass = {
							direction: gameAtStart.passDirection,
							handBeforePass: privateViewAtStart.cards,
							passedCards,
							roundNumber: gameAtStart.roundNumber,
							senderId: passPartnerId(gameAtStart, options.playerId, "sender"),
						}
						appendMemory({
							cards: passedCards,
							direction: gameAtStart.passDirection,
							kind: "cardsPassed",
							recipientId: passPartnerId(
								gameAtStart,
								options.playerId,
								"recipient",
							),
							roundNumber: gameAtStart.roundNumber,
						})
						captureReceivedPassCards()
					}
					span.event(
						"ai.action.acknowledged",
						{
							action: decision.nextAction,
							result,
						},
						result.ok ? "info" : "warn",
					)
					if (!result.ok) {
						lastAttemptedFingerprint = ""
						span.setOutcome("error")
						return
					}
					const reviewPhase: AiStrategyReviewTurn["phase"] =
						gameAtStart.phase === "passing" ? "passing" : "playing"
					silo.setState(state.aiStrategyReviewTurnsAtom, (turns) => [
						...turns,
						{
							action: strategyReviewAction(
								decision.nextAction,
								privateViewAtStart,
							),
							observation: decision.observation,
							phase: reviewPhase,
							plan: decision.currentPlan,
							trickNumber: gameAtStart.trickNumber,
							turnKey,
						},
					])
				},
			)
		} catch {
			lastAttemptedFingerprint = ""
		} finally {
			acting = false
			if (shouldAct()) queueMicrotask(() => void act())
		}
	}

	const scheduleAct = (): void => {
		resetMemoryForNewRound()
		captureReceivedPassCards()
		queueMicrotask(() => void act())
	}
	const stateDisposers = [
		silo.subscribe(publicGameViewAtom, scheduleAct),
		silo.subscribe(privatePlayerViewAtom, scheduleAct),
	]

	const joinAndPull = (): Promise<void> =>
		serverLogger.withRootSpan(
			"ai.realtime.join",
			{
				modelId: options.modelId,
				name: options.name,
				playerId: options.playerId,
				roomCode: options.roomCode,
			},
			(span) =>
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
						span.event("ai.realtime.projections_pulled", {
							atoms: [publicGameViewAtom.key, privatePlayerViewAtom.key],
							result,
						})
						resolve()
					})
				}),
		)

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
			serverLogger.error("ai.realtime.connect_error", {
				error,
				modelId: options.modelId,
				playerId: options.playerId,
				roomCode: options.roomCode,
			})
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
			void serverLogger.withRootSpan(
				"ai.runtime.dispose",
				{
					modelId: options.modelId,
					playerId: options.playerId,
					roomCode: options.roomCode,
				},
				(span) => {
					disposed = true
					for (const dispose of pullDisposers) dispose()
					for (const dispose of stateDisposers) dispose()
					socket.disconnect()
					span.event("ai.runtime.disposed")
				},
			)
		},
		modelId: options.modelId,
		playerId: options.playerId,
		silo,
		state,
	}
}

export async function createAiPlayer(
	options: CreateAiPlayerOptions,
): Promise<AiPlayerRuntime> {
	return serverLogger.withSpan(
		"ai.runtime.create",
		{
			modelId: options.modelId,
			name: options.name,
			playerId: options.playerId,
			roomCode: options.roomCode,
			serverUrl: options.serverUrl,
		},
		async (span) => {
			const runtime = await createAiPlayerRuntime(options)
			span.event("ai.runtime.ready", {
				modelId: runtime.modelId,
				playerId: runtime.playerId,
			})
			return runtime
		},
	)
}
