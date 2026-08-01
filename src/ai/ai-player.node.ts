import { createHash, randomUUID } from "node:crypto"

import { Silo } from "atom.io"
import type { Socket as RealtimeSocket } from "atom.io/realtime"
import { pullAtom } from "atom.io/realtime-client"
import { io, type Socket } from "socket.io-client"

import {
	privatePlayerViewAtom,
	publicGameViewAtom,
} from "../game/game-state-atoms.ts"
import {
	matchingGameKinds,
	registeredGameAdapter,
	registeredGameCapability,
} from "../game/game-registry.ts"
import type {
	AiStrategyReviewAction,
	AiStrategyReviewTurn,
	AnyPrivatePlayerView,
	AnyPublicGameView,
	CardId,
	ClientToServerEvents,
	PassDirection,
	PlayerId,
	PrivatePlayerView,
	PublicGameView,
	HeartsPublicGameView,
	ServerToClientEvents,
	VisibleCard,
	GameKind,
	PrivatePlayerViewFor,
	PublicGameViewFor,
} from "../game/game-types.ts"
import {
	passRecipientSeatIndex,
	passSenderSeatIndex,
} from "../game/seat-order.ts"
import { serverLogger } from "../observability/span-logger.node.ts"
import { aiCardValue, cardIdForAiValue } from "./ai-card-value.ts"
import { aiGameStrategy } from "./ai-game-strategy.ts"
import type { AiGameContext } from "./ai-game-facts.ts"
import { createOpenAiTurnGenerator } from "./ai-generator.node.ts"
import type { AiModelId } from "./ai-models.ts"
import type { AiTurnGenerator } from "./ai-strategy.ts"
import type {
	AiMemoryLedgerEntry,
	AiNextAction,
	SummonersAiAction,
} from "./ai-types.ts"
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
	canAct?: (
		game: AnyPublicGameView,
		privateView: AnyPrivatePlayerView,
	) => boolean
	generateTurn?: AiTurnGenerator
	modelId: AiModelId
	name: string
	playerId: PlayerId
	playerSecret: string
	roomCode: string
	serverUrl: string
}

function aiPublicView(silo: Silo): AnyPublicGameView {
	return silo.getState(publicGameViewAtom)
}

function aiPrivateView(silo: Silo): AnyPrivatePlayerView {
	return silo.getState(privatePlayerViewAtom)
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
} satisfies Partial<Record<PublicGameView["gameKind"], unknown>>

type PassMemoryAdapter = (
	game: PublicGameView,
	privateView: PrivatePlayerView,
	cardIds: CardId[],
	playerId: PlayerId,
) => { entry: AiMemoryLedgerEntry; pendingPass: PendingPass }

export function isAiTurnReady<Kind extends GameKind>(
	playerId: PlayerId,
	game: PublicGameViewFor<Kind>,
	privateView: PrivatePlayerViewFor<Kind>,
): boolean {
	if (privateView.playerId !== playerId) return false
	if (!matchingGameKinds(privateView, game)) return false
	const readiness = registeredGameAdapter<AiTurnReadiness>(
		game.gameKind,
		aiTurnReadiness,
	)
	return readiness(playerId, game, privateView)
}

type AiTurnReadiness = (
	playerId: PlayerId,
	game: AnyPublicGameView,
	privateView: AnyPrivatePlayerView,
) => boolean

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
	summoners: (
		playerId: PlayerId,
		game: Extract<AnyPublicGameView, { gameKind: "summoners" }>,
		privateView: Extract<AnyPrivatePlayerView, { gameKind: "summoners" }>,
	): boolean => {
		if (game.revision !== privateView.revision) return false
		if (game.phase === "lobby") {
			return (
				privateView.playerId === playerId &&
				game.players.find((player) => player.id === playerId)?.deck === null
			)
		}
		return (
			game.phase === "playing" &&
			game.currentPlayerId === playerId &&
			!game.players.find((player) => player.id === playerId)?.eliminated
		)
	},
} satisfies Record<AnyPublicGameView["gameKind"], unknown>

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
	let observedSummonersTurnNumber = -1
	let pullDisposers: Array<() => void> = []
	let pendingPass: PendingPass | undefined

	const appendMemory = (entry: AiMemoryLedgerEntry): void => {
		silo.setState(state.aiMemoryLedgerAtom, (ledger) => [...ledger, entry])
	}

	const resetMemoryForNewRound = (): void => {
		const game = aiPublicView(silo)
		if (game.gameKind === "summoners") {
			if (game.turnNumber === observedSummonersTurnNumber) return
			observedSummonersTurnNumber = game.turnNumber
			lastAttemptedFingerprint = ""
			silo.setState(state.aiCurrentPlanAtom, "")
			silo.setState(state.aiNextActionAtom, null)
			silo.setState(state.aiSummonersTurnLedgerAtom, [])
			return
		}
		const roundNumber = game.roundNumber
		if (roundNumber === observedRoundNumber) return
		observedRoundNumber = roundNumber
		pendingPass = undefined
		lastAttemptedFingerprint = ""
		silo.setState(state.aiMemoryLedgerAtom, [])
		silo.setState(state.aiStrategyReviewTurnsAtom, [])
		silo.setState(state.aiCurrentPlanAtom, "")
		silo.setState(state.aiNextActionAtom, null)
	}

	const captureReceivedPassCards = (): void => {
		if (pendingPass === undefined) return
		const privateView = aiPrivateView(silo)
		if (privateView.gameKind !== "hearts") return
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
		const game = aiPublicView(silo)
		const privateView = aiPrivateView(silo)
		if (game.gameKind === "summoners" && privateView.gameKind === "summoners") {
			return JSON.stringify({
				currentPlayerId: game.currentPlayerId,
				handCardIds: privateView.hand.map((card) => card.physicalId),
				phase: game.phase,
				revision: game.revision,
				players: game.players.map((player) => ({
					battlefield: player.battlefield,
					deckId: player.deck?.id ?? null,
					health: player.health,
					id: player.id,
					powerUsed: player.powerUsed,
					spark: player.spark,
				})),
				turnNumber: game.turnNumber,
			})
		}
		if (game.gameKind === "summoners" || privateView.gameKind === "summoners") {
			throw new Error("AI public and private views describe different games.")
		}
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
			const selectedValues = new Set(action.cards)
			return {
				cards: privateView.cards
					.filter((card) => selectedValues.has(aiCardValue(card)))
					.map(({ rank, suit }) => ({ rank, suit })),
				kind: "passCards",
			}
		}
		if (action.action === "submitBid") {
			return { bid: action.bid, kind: "submitBid" }
		}
		if (action.action !== "playCard") {
			throw new Error("Summoners actions are not included in trick reviews.")
		}
		const playedCard = privateView.cards.find(
			(card) => aiCardValue(card) === action.card,
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
		const game = aiPublicView(silo)
		const privateView = aiPrivateView(silo)
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
			const gameAtStart = aiPublicView(silo)
			const privateViewAtStart = aiPrivateView(silo)
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

					const currentGame = aiPublicView(silo)
					const turnKey =
						currentGame.gameKind === "summoners"
							? `turn-${currentGame.turnNumber}`
							: `round-${currentGame.roundNumber}-trick-${currentGame.trickNumber}`
					const existingPlan = silo.getState(state.aiCurrentPlanAtom)
					const turnObjective =
						currentGame.gameKind === "summoners" && existingPlan.length > 0
							? existingPlan
							: decision.currentPlan
					silo.setState(state.aiCurrentPlanAtom, turnObjective)
					silo.setState(state.aiNextActionAtom, decision.nextAction)
					span.event("ai.state.updated", {
						actionReason: decision.actionReason,
						currentPlan: turnObjective,
						nextAction: decision.nextAction,
						turnKey,
					})

					const actionContext = {
						memoryLedger: silo.getState(state.aiMemoryLedgerAtom),
						playerId: options.playerId,
						previousPlan: turnObjective,
						privateView: privateViewAtStart,
						publicView: gameAtStart,
						summonersTurnLedger: silo.getState(state.aiSummonersTurnLedgerAtom),
					} as AiGameContext
					const result = await aiGameStrategy(
						gameAtStart.gameKind,
					).submitAction(socket, decision.nextAction, actionContext)
					const nextAction = decision.nextAction
					if (result.ok && nextAction.action === "passCards") {
						if (
							gameAtStart.gameKind !== "hearts" ||
							privateViewAtStart.gameKind !== "hearts"
						) {
							throw new Error("Only Hearts supports AI card-pass memory.")
						}
						const passMemory = registeredGameCapability<PassMemoryAdapter>(
							gameAtStart.gameKind,
							passMemoryAdapters,
						)
						if (
							passMemory === null ||
							!matchingGameKinds(privateViewAtStart, gameAtStart)
						) {
							throw new Error(
								`${gameAtStart.gameKind} does not support AI card-pass memory.`,
							)
						}
						const capturedPass = passMemory(
							gameAtStart,
							privateViewAtStart,
							nextAction.cards.map((card) =>
								cardIdForAiValue(privateViewAtStart.cards, card),
							),
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
					if (gameAtStart.gameKind === "summoners") {
						silo.setState(state.aiSummonersTurnLedgerAtom, (ledger) => [
							...ledger,
							{
								action: nextAction as SummonersAiAction,
								actionReason:
									decision.actionReason ?? "No action reason supplied.",
							},
						])
					}
					if (
						gameAtStart.gameKind === "summoners" ||
						privateViewAtStart.gameKind === "summoners"
					) {
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
							action: strategyReviewAction(nextAction, privateViewAtStart),
							phase: reviewPhase,
							plan: decision.currentPlan,
							trickNumber: gameAtStart.trickNumber,
							turnKey,
						},
					])
				},
			)
		} catch (error) {
			serverLogger.error("ai.turn.failed", {
				error,
				fingerprintId: fingerprintId(fingerprint),
				modelId: options.modelId,
				playerId: options.playerId,
				roomCode: options.roomCode,
			})
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
