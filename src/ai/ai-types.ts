import type {
	CardId,
	GameKind,
	PassDirection,
	PlayerId,
	VisibleCard,
} from "../game/game-types.ts"

export type HeartsAiNextAction =
	| { action: "passCards"; cardIds: CardId[] }
	| { action: "playCard"; cardId: CardId }

export type OhHellAiNextAction =
	| { action: "playCard"; cardId: CardId }
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

export type HeartsPassMemoryEntry =
	| {
			cards: VisibleCard[]
			direction: PassDirection
			kind: "cardsPassed"
			recipientId: PlayerId
			roundNumber: number
	  }

export type AiMemoryLedgerEntry = HeartsPassMemoryEntry
	| {
			cards: VisibleCard[]
			direction: PassDirection
			kind: "cardsReceived"
			roundNumber: number
			senderId: PlayerId
	  }
