import type {
	GameKind,
	PassDirection,
	PlayerId,
	VisibleCard,
} from "../game/game-types.ts"

type AiCardRank =
	| "2"
	| "3"
	| "4"
	| "5"
	| "6"
	| "7"
	| "8"
	| "9"
	| "T"
	| "J"
	| "Q"
	| "K"
	| "A"
type AiCardSuit = "C" | "D" | "H" | "S"

export type AiCardValue = `${AiCardRank}${AiCardSuit}`

export type HeartsAiNextAction =
	| { action: "passCards"; cards: AiCardValue[] }
	| { action: "playCard"; card: AiCardValue }

export type OhHellAiNextAction =
	| { action: "playCard"; card: AiCardValue }
	| { action: "submitBid"; bid: number }

export type AiNextActionByGame = {
	hearts: HeartsAiNextAction
	ohHell: OhHellAiNextAction
}

export type AiNextActionFor<Kind extends GameKind> = AiNextActionByGame[Kind]
export type AiNextAction = AiNextActionFor<GameKind>

export type AiTurnDecisionFor<Kind extends GameKind> = {
	currentPlan: string
	nextAction: AiNextActionFor<Kind>
	observation: string
}

export type AiTurnDecision = AiTurnDecisionFor<GameKind>

export type AiTurnObservation = {
	observation: string
	turnKey: string
}

export type HeartsPassMemoryEntry = {
	cards: VisibleCard[]
	direction: PassDirection
	kind: "cardsPassed"
	recipientId: PlayerId
	roundNumber: number
}

export type AiMemoryLedgerEntry =
	| HeartsPassMemoryEntry
	| {
			cards: VisibleCard[]
			direction: PassDirection
			kind: "cardsReceived"
			roundNumber: number
			senderId: PlayerId
	  }
