import type {
	PassDirection,
	PlayerId,
	VisibleCard,
} from "../game/game-types.ts"
import type { SummonersDeckId } from "../summoners/summoners-types.ts"

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

export type SummonersAiNextAction =
	| { action: "attack"; attacker: string; target: string }
	| { action: "endTurn" }
	| {
			action: "playCard"
			card: string
			target: string | null
	  }
	| { action: "selectDeck"; deck: SummonersDeckId }
	| { action: "usePower"; target: string | null }

export type AiNextActionByGame = {
	hearts: HeartsAiNextAction
	ohHell: OhHellAiNextAction
	summoners: SummonersAiNextAction
}

export type AiGameKind = keyof AiNextActionByGame
export type AiNextActionFor<Kind extends AiGameKind> = AiNextActionByGame[Kind]
export type AiNextAction = AiNextActionFor<AiGameKind>

export type AiTurnDecisionFor<Kind extends AiGameKind> = {
	currentPlan: string
	nextAction: AiNextActionFor<Kind>
}

export type AiTurnDecision = AiTurnDecisionFor<AiGameKind>

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
