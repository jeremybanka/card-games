import type { AiModelId } from "../ai/ai-models.ts"

export type Suit = "clubs" | "diamonds" | "spades" | "hearts"
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14
export type CardId = `card::${string}`
export type PlayerId = `user::${string}`

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
	plays: TrickPlay[]
	winnerId: PlayerId
}

export type GamePhase =
	| "lobby"
	| "passing"
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
}

export type PublicGameView = {
	completedTricks: CompletedTrick[]
	currentPlayerId: PlayerId | null
	currentTrick: TrickPlay[]
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
}

export type PrivatePlayerView = {
	cards: VisibleCard[]
	passSubmitted: boolean
	playableCardIds: CardId[]
	playerId: PlayerId | null
}

export type ActionResult =
	| { ok: true; roomCode: string }
	| { ok: false; error: string }

export type ActionAck = (result: ActionResult) => void

export type ClientToServerEvents = {
	assignAiSeat: (modelId: AiModelId, ack: ActionAck) => void
	createRoom: (playerName: string, ack: ActionAck) => void
	joinRoom: (roomCode: string, playerName: string, ack: ActionAck) => void
	leaveRoom: (ack: ActionAck) => void
	passCards: (cardIds: CardId[], ack: ActionAck) => void
	playCard: (cardId: CardId, ack: ActionAck) => void
	removeAiSeat: (playerId: PlayerId, ack: ActionAck) => void
	restartGame: (ack: ActionAck) => void
	startGame: (ack: ActionAck) => void
	startNextRound: (ack: ActionAck) => void
}

export type ServerToClientEvents = {
	roomClosed: (message: string) => void
}

export const EMPTY_PUBLIC_GAME_VIEW: PublicGameView = {
	completedTricks: [],
	currentPlayerId: null,
	currentTrick: [],
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

export const EMPTY_PRIVATE_PLAYER_VIEW: PrivatePlayerView = {
	cards: [],
	passSubmitted: false,
	playableCardIds: [],
	playerId: null,
}
