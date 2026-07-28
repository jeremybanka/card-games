import { type } from "arktype"
import type { JSONSchema7 } from "ai"

import { cardIdType } from "../game/game-actions.ts"
import { passCardIdsType } from "../game/hearts-actions.ts"
import type {
	CardId,
	PassDirection,
	PlayerId,
	VisibleCard,
} from "../game/game-types.ts"

export type AiNextAction =
	| { action: "passCards"; cardIds: CardId[] }
	| { action: "playCard"; cardId: CardId }
	| { action: "submitBid"; bid: number }

export type AiTurnDecision = {
	currentPlan: string
	nextAction: AiNextAction
	observation: string
}

export type AiTurnObservation = {
	observation: string
	turnKey: string
}

export type AiMemoryLedgerEntry =
	| {
			cards: VisibleCard[]
			direction: PassDirection
			kind: "cardsPassed"
			recipientId: PlayerId
			roundNumber: number
	  }
	| {
			cards: VisibleCard[]
			direction: PassDirection
			kind: "cardsReceived"
			roundNumber: number
			senderId: PlayerId
	  }

export const aiNextActionType = type({
	action: "'passCards'",
	cardIds: passCardIdsType,
})
	.or({
		action: "'playCard'",
		cardId: cardIdType,
	})
	.or({
		action: "'submitBid'",
		bid: "number.integer >= 0",
	})

export const aiTurnDecisionType = type({
	currentPlan: "string",
	nextAction: aiNextActionType,
	observation: "string",
})

export const aiTurnDecisionJsonSchema: JSONSchema7 = {
	additionalProperties: false,
	properties: {
		currentPlan: { type: "string" },
		nextAction: {
			anyOf: [
				{
					additionalProperties: false,
					properties: {
						action: { enum: ["passCards"], type: "string" },
						cardIds: {
							items: { pattern: "^card::", type: "string" },
							maxItems: 3,
							minItems: 3,
							type: "array",
						},
					},
					required: ["action", "cardIds"],
					type: "object",
				},
				{
					additionalProperties: false,
					properties: {
						action: { enum: ["playCard"], type: "string" },
						cardId: { pattern: "^card::", type: "string" },
					},
					required: ["action", "cardId"],
					type: "object",
				},
			],
		},
		observation: { type: "string" },
	},
	required: ["currentPlan", "nextAction", "observation"],
	type: "object",
}
