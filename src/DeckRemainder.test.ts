// @vitest-environment happy-dom

import { screen } from "@testing-library/react"
import { createElement, render } from "preact"
import { beforeEach, describe, expect, it } from "vitest"

import { DeckRemainder } from "./DeckRemainder.tsx"
import type { CardId } from "./game/game-types.ts"

describe("DeckRemainder", () => {
	beforeEach(() => {
		render(null, document.body)
		document.body.replaceChildren()
	})

	for (const playerCount of [2, 4]) {
		it(`shows an empty deal remainder for ${playerCount} players`, () => {
			render(createElement(DeckRemainder, { cardIds: [] }), document.body)

			const deck = screen.getByRole("img", { name: "Deck is empty" })
			expect(deck.querySelectorAll("span")).toHaveLength(0)
			expect(deck.getAttribute("data-card-motion-origin")).toBe("deck")
		})
	}

	it("shows the single authoritative remainder for three players", () => {
		render(
			createElement(DeckRemainder, {
				cardIds: ["card::leftover" satisfies CardId],
			}),
			document.body,
		)

		expect(
			screen
				.getByRole("img", { name: "1 card remains in the deck" })
				.querySelectorAll("span"),
		).toHaveLength(1)
	})
})
