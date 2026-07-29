import { ArkErrors, type } from "arktype"

import type { CardId } from "./game-types.ts"

export class GameActionError extends Error {}

export const cardIdType = type(/^card::.+/)

export const playCardPayloadType = type({
	cardId: cardIdType,
})

export function parsePlayCardPayload(input: unknown): { cardId: CardId } {
	const result = playCardPayloadType(input)
	if (result instanceof ArkErrors) {
		throw new GameActionError(
			`That card identifier is invalid. ${result.summary}`,
		)
	}
	return { cardId: result.cardId as CardId }
}
