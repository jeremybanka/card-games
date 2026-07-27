import type { AiModelId } from "../ai/ai-models.ts"

export type Suit = "clubs" | "diamonds" | "spades" | "hearts"
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14
export type CardId = `card::${string}`
export type PlayerId = `user::${string}`
export type GameKind = "hearts" | "ohHell"

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

export type GamePhase =
	| "lobby"
	| "passing"
	| "bidding"
	| "playing"
	| "roundComplete"
	| "gameComplete"

export type PassDirection = "left" | "right" | "across" | "hold"

export type PublicPlayerView = {
	aiModel: AiModelId | null
	capturedCardIds: CardId[]
	connected: boolean
	handCardIds: CardId[]
	id: PlayerId
	kind: "ai" | "human"
	name: string
	roundPoints: number
	score: number
	bid?: number | null
	tricksWon?: number
}

export type PublicGameView = {
	gameKind?: GameKind
	completedTricks: CompletedTrick[]
	currentPlayerId: PlayerId | null
	currentTrick: TrickPlay[]
	deckCardIds: CardId[]
	heartsBroken: boolean
	hostId: PlayerId | null
	lastTrickWinnerId: PlayerId | null
	passDirection: PassDirection
	passSubmittedPlayerIds: PlayerId[]
	phase: GamePhase
	players: PublicPlayerView[]
	roomCode: string
	roundNumber: number
	statusMessage: string
	trickLeaderId: PlayerId | null
	trickNumber: number
	winnerIds: PlayerId[]
	dealerId?: PlayerId | null
	trumpSuit?: Suit | null
	roundHandSize?: number
	bidPlayerId?: PlayerId | null
	bidsSubmitted?: number
	maximumRounds?: number
}

export type PrivatePlayerView = {
	awardedLeftoverCard?: VisibleCard | null
	cards: VisibleCard[]
	passReceipt?: {
		cards: VisibleCard[]
		roundNumber: number
		senderId: PlayerId
	} | null
	passSubmitted: boolean
	playableCardIds: CardId[]
	playerId: PlayerId | null
	legalBids?: number[]
}

export type AiStrategyReviewAction =
	| { cards: CardValue[]; kind: "passCards" }
	| { card: CardValue; kind: "playCard" }
	| { bid: number; kind: "submitBid" }

export type AiStrategyReviewTurn = {
	action: AiStrategyReviewAction
	observation: string
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

export type ClientToServerEvents = {
	assignAiSeat: (modelId: AiModelId, ack: ActionAck) => void
	createRoom: (playerName: string, gameKind: GameKind, ack: ActionAck) => void
	joinRoom: (roomCode: string, playerName: string, ack: ActionAck) => void
	leaveRoom: (ack: ActionAck) => void
	passCards: (cardIds: CardId[], ack: ActionAck) => void
	playCard: (cardId: CardId, ack: ActionAck) => void
	submitBid: (bid: number, ack: ActionAck) => void
	removeAiSeat: (playerId: PlayerId, ack: ActionAck) => void
	requestAiStrategyReview: (
		playerId: PlayerId,
		ack: AiStrategyReviewAck,
	) => void
	restartGame: (ack: ActionAck) => void
	startGame: (ack: ActionAck) => void
	startNextRound: (ack: ActionAck) => void
}

export type ServerToClientEvents = {
	roomClosed: (message: string) => void
}

export const EMPTY_PUBLIC_GAME_VIEW: PublicGameView = {
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
	dealerId: null,
	trumpSuit: null,
	roundHandSize: 0,
	bidPlayerId: null,
	bidsSubmitted: 0,
	maximumRounds: 0,
}

export const EMPTY_PRIVATE_PLAYER_VIEW: PrivatePlayerView = {
	awardedLeftoverCard: null,
	cards: [],
	passReceipt: null,
	passSubmitted: false,
	playableCardIds: [],
	playerId: null,
	legalBids: [],
}
