import { ArkErrors, type } from "arktype"

import { HeartsRuleError } from "./hearts-engine.ts"
import type { CardId } from "./hearts-types.ts"

export const cardIdType = type(/^card::.+/)
export const passCardIdsType = cardIdType
	.array()
	.atLeastLength(3)
	.atMostLength(3)

export const playCardPayloadType = type({
	cardId: cardIdType,
})

export const passCardsPayloadType = type({
	cardIds: passCardIdsType,
})

function actionError(
	result: unknown,
	fallbackMessage: string,
): HeartsRuleError {
	if (result instanceof ArkErrors) {
		return new HeartsRuleError(`${fallbackMessage} ${result.summary}`)
	}
	return new HeartsRuleError(fallbackMessage)
}

export function parsePlayCardPayload(input: unknown): { cardId: CardId } {
	const result = playCardPayloadType(input)
	if (result instanceof ArkErrors) {
		throw actionError(result, "That card identifier is invalid.")
	}
	return { cardId: result.cardId as CardId }
}

export function parsePassCardsPayload(input: unknown): { cardIds: CardId[] } {
	const result = passCardsPayloadType(input)
	if (result instanceof ArkErrors) {
		throw actionError(result, "The submitted pass is invalid.")
	}
	if (new Set(result.cardIds).size !== result.cardIds.length) {
		throw new HeartsRuleError("Pass three different cards.")
	}
	return { cardIds: result.cardIds as CardId[] }
}
