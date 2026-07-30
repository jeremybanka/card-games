import { ArkErrors, type } from "arktype"

import type { CardId, PlayerId } from "../game/game-types.ts"
import type { SummonersTarget } from "./summoners-types.ts"

const summonersTargetType = type({
	kind: "'being' | 'summoner'",
	playerId: /^user::.+/,
	"cardId?": /^card::.+/,
})

export function parseSummonersTarget(input: unknown): SummonersTarget | null {
	if (input === null) return null
	const result = summonersTargetType(input)
	if (result instanceof ArkErrors) {
		throw new Error(`That target is invalid. ${result.summary}`)
	}
	if (result.kind === "being") {
		if (result.cardId === undefined) {
			throw new Error("A Being target needs a physical card ID.")
		}
		return {
			cardId: result.cardId as CardId,
			kind: "being",
			playerId: result.playerId as PlayerId,
		}
	}
	return {
		kind: "summoner",
		playerId: result.playerId as PlayerId,
	}
}
