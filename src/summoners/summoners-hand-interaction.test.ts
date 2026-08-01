// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest"

import {
	closestSummonersHandCard,
	summonersHandCardAtPoint,
	summonersHandCardCandidates,
} from "./summoners-hand-interaction.ts"

function handCard(
	id: string,
	left: number,
	right: number,
	disabled = false,
): HTMLElement {
	const card = document.createElement("summoners-hand-card")
	card.dataset.cardId = id
	if (disabled) card.dataset.disabled = ""
	vi.spyOn(card, "getBoundingClientRect").mockReturnValue({
		bottom: 200,
		height: 100,
		left,
		right,
		toJSON: () => ({}),
		top: 100,
		width: right - left,
		x: left,
		y: 100,
	})
	return card
}

describe("Summoners stable hand hit surface", () => {
	it("chooses from resting wrappers and ignores unplayable cards", () => {
		const hand = document.createElement("player-hand")
		const surface = document.createElement("hand-hit-surface")
		const left = handCard("left", 100, 200)
		const blocked = handCard("blocked", 180, 280, true)
		const right = handCard("right", 260, 360)
		hand.append(surface, left, blocked, right)

		const candidates = summonersHandCardCandidates(surface)
		expect(candidates.map((card) => card.dataset.cardId)).toEqual([
			"left",
			"right",
		])
		expect(closestSummonersHandCard(candidates, 175)).toBe(left)
		expect(closestSummonersHandCard(candidates, 305)).toBe(right)
	})

	it("keeps the hit decision within the resting card bounds", () => {
		const left = handCard("left", 100, 220)
		const right = handCard("right", 200, 320)

		expect(summonersHandCardAtPoint([left, right], 220, 140)).toBe(right)
		expect(summonersHandCardAtPoint([left, right], 220, 90)).toBeNull()
	})
})
