// @vitest-environment happy-dom

import { waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import type { CardId } from "../game/game-types.ts"
import {
	capturePendingSummonersCardMotion,
	observeSummonersCardMotion,
} from "./summoners-card-motion.ts"

function cardRect(left: number, top: number): DOMRect {
	return {
		bottom: top + 140,
		height: 140,
		left,
		right: left + 98,
		toJSON: () => ({}),
		top,
		width: 98,
		x: left,
		y: top,
	}
}

function physicalCard(cardId: CardId): HTMLElement {
	const card = document.createElement("summoners-card")
	card.dataset.cardId = cardId
	card.getBoundingClientRect = () =>
		card.closest("player-hand") === null
			? cardRect(320, 120)
			: cardRect(80, 360)
	return card
}

afterEach(() => {
	document.body.replaceChildren()
})

describe("observeSummonersCardMotion", () => {
	it("tracks a summoned card from the hand to the battlefield", async () => {
		const root = document.createElement("summoners-table")
		const hand = document.createElement("player-hand")
		const battlefield = document.createElement("player-battlefield")
		const cardId = "card::summoned" satisfies CardId
		const card = physicalCard(cardId)
		hand.append(card)
		root.append(hand, battlefield)
		document.body.append(root)
		const stop = observeSummonersCardMotion(root)

		capturePendingSummonersCardMotion(root, cardId)
		battlefield.append(card)

		await waitFor(() => {
			expect(root.dataset.lastSummonersCardMotion).toBe("play")
			expect(root.dataset.lastSummonersCardMotionId).toBe(cardId)
		})
		stop()
	})

	it("tracks a spell leaving the hand", async () => {
		const root = document.createElement("summoners-table")
		const hand = document.createElement("player-hand")
		const channel = document.createElement("action-channel")
		const cardId = "card::spell" satisfies CardId
		const card = physicalCard(cardId)
		hand.append(card)
		root.append(channel, hand)
		document.body.append(root)
		const stop = observeSummonersCardMotion(root)

		capturePendingSummonersCardMotion(root, cardId)
		card.remove()

		await waitFor(() => {
			expect(root.dataset.lastSummonersCardMotion).toBe("cast")
			expect(root.dataset.lastSummonersCardMotionId).toBe(cardId)
		})
		stop()
	})
})
