import { ArkErrors, type } from "arktype"

import { cardIdType } from "./game-actions.ts"
import { HeartsRuleError } from "./hearts-engine.ts"
import type { CardId } from "./game-types.ts"

export const passCardIdsType = cardIdType
	.array()
	.atLeastLength(3)
	.atMostLength(3)

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
