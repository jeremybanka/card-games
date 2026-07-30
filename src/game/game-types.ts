import type { AiModelId } from "../ai/ai-models.ts"
import type {
	SummonersClientEvents,
	SummonersPrivatePlayerView,
	SummonersPublicGameView,
} from "../summoners/summoners-types.ts"
import type { GameKind } from "./game-kinds.ts"
import type { OhHellRules } from "./oh-hell-rules.ts"

export type { GameKind } from "./game-kinds.ts"

export type Suit = "clubs" | "diamonds" | "spades" | "hearts"
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14
export type CardId = `card::${string}`
export type PlayerId = `user::${string}`

export type PlayerController = {
	aiModel: AiModelId | null
	kind: "ai" | "human"
}
export type CardValue = {
	rank: Rank
	suit: Suit
}

export type VisibleCard = CardValue & {
	id: CardId
}

export type TrickPlay = {
	card: VisibleCard
	playerId: PlayerId
}

export type CompletedTrick = {
	leftoverAward: {
		cardId: CardId
		recipientId: PlayerId
	} | null
	plays: TrickPlay[]
	winnerId: PlayerId
}

export type HeartsPhase =
	| "lobby"
	| "passing"
	| "playing"
	| "roundComplete"
	| "gameComplete"

export type OhHellPhase =
	| "lobby"
	| "bidding"
	| "playing"
	| "roundComplete"
	| "gameComplete"

export type PassDirection = "left" | "right" | "across" | "hold"

type TrickTakingPublicPlayerFields = {
	aiModel: AiModelId | null
	bid?: number | null
	capturedCardIds?: CardId[]
	connected: boolean
	handCardIds: CardId[]
	id: PlayerId
	kind: "ai" | "human"
	name: string
	roundPoints: number
	score: number
	tricksWon?: number
}

export type HeartsPublicPlayerView = TrickTakingPublicPlayerFields & {
	bid?: never
	capturedCardIds: CardId[]
	tricksWon?: never
}

export type OhHellPublicPlayerView = TrickTakingPublicPlayerFields & {
	bid: number | null
	capturedCardIds?: never
	tricksWon: number
}

export type PublicPlayerView = HeartsPublicPlayerView | OhHellPublicPlayerView

type TrickTakingPublicGameFields = {
	completedTricks: CompletedTrick[]
	currentPlayerId: PlayerId | null
	currentTrick: TrickPlay[]
	deckCardIds: CardId[]
	hostId: PlayerId | null
	lastTrickWinnerId: PlayerId | null
	roomCode: string
	roundNumber: number
	statusMessage: string
	trickLeaderId: PlayerId | null
	trickNumber: number
	winnerIds: PlayerId[]
}

export type HeartsPublicGameView = TrickTakingPublicGameFields & {
	bidPlayerId?: never
	bidsSubmitted?: never
	dealerId?: never
	gameKind: "hearts"
	heartsBroken: boolean
	maximumRounds?: never
	passDirection: PassDirection
	passSubmittedPlayerIds: PlayerId[]
	phase: HeartsPhase
	players: HeartsPublicPlayerView[]
	roundHandSize?: never
	trumpSuit?: never
}

export type OhHellPublicGameView = TrickTakingPublicGameFields & {
	bidPlayerId: PlayerId | null
	bidsSubmitted: number
	dealerId: PlayerId | null
	gameKind: "ohHell"
	heartsBroken?: never
	maximumRounds: number
	passDirection?: never
	passSubmittedPlayerIds?: never
	phase: OhHellPhase
	players: OhHellPublicPlayerView[]
	rules: OhHellRules
	roundHandSize: number
	trumpSuit: Suit | null
}

export type PublicGameView = HeartsPublicGameView | OhHellPublicGameView
export type AnyPublicGameView = PublicGameView | SummonersPublicGameView
export type PublicGameViewFor<Kind extends GameKind> = Extract<
	AnyPublicGameView,
	{ gameKind: Kind }
>

type TrickTakingPrivatePlayerFields = {
	cards: VisibleCard[]
	playableCardIds: CardId[]
	playerId: PlayerId | null
}

export type HeartsPrivatePlayerView = TrickTakingPrivatePlayerFields & {
	awardedLeftoverCard: VisibleCard | null
	gameKind: "hearts"
	legalBids?: never
	passReceipt: {
		cards: VisibleCard[]
		roundNumber: number
		senderId: PlayerId
	} | null
	passSubmitted: boolean
}

export type OhHellPrivatePlayerView = TrickTakingPrivatePlayerFields & {
	awardedLeftoverCard?: never
	gameKind: "ohHell"
	legalBids: number[]
	passReceipt?: never
	passSubmitted?: never
}

export type PrivatePlayerView =
	| HeartsPrivatePlayerView
	| OhHellPrivatePlayerView
export type AnyPrivatePlayerView =
	| PrivatePlayerView
	| SummonersPrivatePlayerView
export type PrivatePlayerViewFor<Kind extends GameKind> = Extract<
	AnyPrivatePlayerView,
	{ gameKind: Kind }
>

export type AiStrategyReviewAction =
	| { cards: CardValue[]; kind: "passCards" }
	| { card: CardValue; kind: "playCard" }
	| { bid: number; kind: "submitBid" }

export type AiStrategyReviewTurn = {
	action: AiStrategyReviewAction
	phase: "passing" | "bidding" | "playing"
	plan: string
	trickNumber: number
	turnKey: string
}

export type AiStrategyReview = {
	modelId: AiModelId
	playerId: PlayerId
	playerName: string
	roundNumber: number
	turns: AiStrategyReviewTurn[]
}

export type ActionResult =
	| { ok: true; roomCode: string }
	| { ok: false; error: string }

export type ActionAck = (result: ActionResult) => void

export type AiStrategyReviewResult =
	| { ok: true; review: AiStrategyReview }
	| { ok: false; error: string }

export type AiStrategyReviewAck = (result: AiStrategyReviewResult) => void

export type RoomClientEvents = {
	createRoom: (playerName: string, gameKind: GameKind, ack: ActionAck) => void
	joinRoom: (roomCode: string, playerName: string, ack: ActionAck) => void
	leaveRoom: (ack: ActionAck) => void
}

export type AiSeatClientEvents = {
	assignAiSeat: (modelId: AiModelId, ack: ActionAck) => void
	removeAiSeat: (playerId: PlayerId, ack: ActionAck) => void
	requestAiStrategyReview: (
		playerId: PlayerId,
		ack: AiStrategyReviewAck,
	) => void
}

export type PassCardsClientEvents = {
	passCards: (cardIds: CardId[], ack: ActionAck) => void
}

export type PlayCardClientEvents = {
	playCard: (cardId: CardId, ack: ActionAck) => void
}

export type SubmitBidClientEvents = {
	submitBid: (bid: number, ack: ActionAck) => void
}

export type ConfigureOhHellRulesClientEvents = {
	configureOhHellRules: (rules: OhHellRules, ack: ActionAck) => void
}

export type RoundLifecycleClientEvents = {
	restartGame: (ack: ActionAck) => void
	startGame: (ack: ActionAck) => void
	startNextRound: (ack: ActionAck) => void
}

export type HeartsClientEvents = AiSeatClientEvents &
	PassCardsClientEvents &
	PlayCardClientEvents &
	RoundLifecycleClientEvents

export type OhHellClientEvents = AiSeatClientEvents &
	ConfigureOhHellRulesClientEvents &
	PlayCardClientEvents &
	RoundLifecycleClientEvents &
	SubmitBidClientEvents

export type ClientToServerEvents = RoomClientEvents &
	HeartsClientEvents &
	OhHellClientEvents &
	SummonersClientEvents

export type ServerToClientEvents = {
	roomClosed: (message: string) => void
}

export const EMPTY_HEARTS_PUBLIC_GAME_VIEW: HeartsPublicGameView = {
	gameKind: "hearts",
	completedTricks: [],
	currentPlayerId: null,
	currentTrick: [],
	deckCardIds: [],
	heartsBroken: false,
	hostId: null,
	lastTrickWinnerId: null,
	passDirection: "hold",
	passSubmittedPlayerIds: [],
	phase: "lobby",
	players: [],
	roomCode: "",
	roundNumber: 0,
	statusMessage: "Connecting to the table…",
	trickLeaderId: null,
	trickNumber: 0,
	winnerIds: [],
}

export const EMPTY_HEARTS_PRIVATE_PLAYER_VIEW: HeartsPrivatePlayerView = {
	awardedLeftoverCard: null,
	cards: [],
	gameKind: "hearts",
	passReceipt: null,
	passSubmitted: false,
	playableCardIds: [],
	playerId: null,
}
