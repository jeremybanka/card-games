import { createHash, randomUUID } from "node:crypto"

import { Silo } from "atom.io"
import type { Socket as RealtimeSocket } from "atom.io/realtime"
import { pullAtom } from "atom.io/realtime-client"
import { io, type Socket } from "socket.io-client"

import {
	privatePlayerViewAtom,
	publicGameViewAtom,
} from "../game/game-state-atoms.ts"
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
	HeartsPublicGameView,
	ServerToClientEvents,
	VisibleCard,
} from "../game/game-types.ts"
import {
	passRecipientSeatIndex,
	passSenderSeatIndex,
} from "../game/seat-order.ts"
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

type PendingPass = {
	direction: PassDirection
	handBeforePass: VisibleCard[]
	passedCards: VisibleCard[]
	roundNumber: number
	senderId: PlayerId
}

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

function passPartnerId(
	game: HeartsPublicGameView,
	playerId: PlayerId,
	role: "recipient" | "sender",
): PlayerId {
	const playerIndex = game.players.findIndex((player) => player.id === playerId)
	if (playerIndex === -1) {
		throw new Error("The AI player is not seated at its realtime table.")
	}
	const partnerIndex =
		role === "recipient"
			? passRecipientSeatIndex(
					playerIndex,
					game.players.length,
					game.passDirection,
				)
			: passSenderSeatIndex(
					playerIndex,
					game.players.length,
					game.passDirection,
				)
	return (game.players[partnerIndex] as PublicGameView["players"][number]).id
}

const passMemoryAdapters = {
	hearts: (
		game: Extract<PublicGameView, { gameKind: "hearts" }>,
		privateView: Extract<PrivatePlayerView, { gameKind: "hearts" }>,
		cardIds: CardId[],
		playerId: PlayerId,
	): { entry: AiMemoryLedgerEntry; pendingPass: PendingPass } => {
		const selectedIds = new Set(cardIds)
		const passedCards = privateView.cards.filter((card) =>
			selectedIds.has(card.id),
		)
		return {
			entry: {
				cards: passedCards,
				direction: game.passDirection,
				kind: "cardsPassed",
				recipientId: passPartnerId(game, playerId, "recipient"),
				roundNumber: game.roundNumber,
			},
			pendingPass: {
				direction: game.passDirection,
				handBeforePass: privateView.cards,
				passedCards,
				roundNumber: game.roundNumber,
				senderId: passPartnerId(game, playerId, "sender"),
			},
		}
	},
} as unknown as Partial<
	Record<
		PublicGameView["gameKind"],
		(
			game: PublicGameView,
			privateView: PrivatePlayerView,
			cardIds: CardId[],
			playerId: PlayerId,
		) => { entry: AiMemoryLedgerEntry; pendingPass: PendingPass }
	>
>

function submitAiAction(
	socket: AiSocket,
	action: AiNextAction,
): Promise<ActionResult> {
	return new Promise((resolve) => {
		switch (action.action) {
			case "passCards":
				socket.emit("passCards", action.cardIds, resolve)
				return
			case "submitBid":
				socket.emit("submitBid", action.bid, resolve)
				return
			case "playCard":
				socket.emit("playCard", action.cardId, resolve)
		}
	})
}

export function isAiTurnReady(
	playerId: PlayerId,
	game: PublicGameView,
	privateView: PrivatePlayerView,
): boolean {
	if (privateView.playerId !== playerId) return false
	if (privateView.gameKind !== game.gameKind) {
		return false
	}
	return aiTurnReadiness[game.gameKind](
		playerId,
		game as never,
		privateView as never,
	)
}

const aiTurnReadiness = {
	hearts: (
		playerId: PlayerId,
		game: Extract<PublicGameView, { gameKind: "hearts" }>,
		privateView: Extract<PrivatePlayerView, { gameKind: "hearts" }>,
	): boolean =>
		game.phase === "passing"
			? !privateView.passSubmitted && privateView.cards.length >= 3
			: game.phase === "playing" &&
				game.currentPlayerId === playerId &&
				privateView.playableCardIds.length > 0,
	ohHell: (
		playerId: PlayerId,
		game: Extract<PublicGameView, { gameKind: "ohHell" }>,
		privateView: Extract<PrivatePlayerView, { gameKind: "ohHell" }>,
	): boolean =>
		game.phase === "bidding"
			? game.currentPlayerId === playerId && privateView.legalBids.length > 0
			: game.phase === "playing" &&
				game.currentPlayerId === playerId &&
				privateView.playableCardIds.length > 0,
} satisfies Record<
	PublicGameView["gameKind"],
	(playerId: PlayerId, game: never, privateView: never) => boolean
>

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
	let pendingPass: PendingPass | undefined

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
		if (action.action === "submitBid") {
			return { bid: action.bid, kind: "submitBid" }
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

					const result = await submitAiAction(socket, decision.nextAction)
					if (result.ok && decision.nextAction.action === "passCards") {
						const passMemory = passMemoryAdapters[gameAtStart.gameKind]
						if (
							passMemory === undefined ||
							privateViewAtStart.gameKind !== gameAtStart.gameKind
						) {
							throw new Error(
								`${gameAtStart.gameKind} does not support AI card-pass memory.`,
							)
						}
						const capturedPass = passMemory(
							gameAtStart,
							privateViewAtStart,
							decision.nextAction.cardIds,
							options.playerId,
						)
						pendingPass = capturedPass.pendingPass
						appendMemory(capturedPass.entry)
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
						gameAtStart.phase === "passing"
							? "passing"
							: gameAtStart.phase === "bidding"
								? "bidding"
								: "playing"
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
