import type { CardId, PlayerId } from "../game/game-types.ts"
import type { SummonersTarget } from "./summoners-types.ts"

export function summonersTargetFromElements(
	elements: readonly Element[],
): SummonersTarget | undefined {
	for (const element of elements) {
		const targetElement = element.closest<HTMLElement>(
			"[data-summoners-target-kind]",
		)
		if (
			targetElement === null ||
			targetElement.closest("[data-attacker-dragging]") !== null
		) {
			continue
		}
		const playerId = targetElement.dataset.summonersTargetPlayerId as
			| PlayerId
			| undefined
		if (playerId === undefined) continue
		if (targetElement.dataset.summonersTargetKind === "summoner") {
			return { kind: "summoner", playerId }
		}
		const cardId = targetElement.dataset.summonersTargetCardId as
			| CardId
			| undefined
		if (cardId !== undefined) {
			return { cardId, kind: "being", playerId }
		}
	}
	return undefined
}
