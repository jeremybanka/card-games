// @vitest-environment happy-dom

import { fireEvent, screen, waitFor } from "@testing-library/react"
import { createElement, render } from "preact"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { PassReceipt } from "./PassReceipt.tsx"

describe("PassReceipt", () => {
	beforeEach(() => {
		render(null, document.body)
		document.body.replaceChildren()
	})

	it("names the sender and all three stable physical cards until dismissal", async () => {
		const onDismiss = vi.fn()
		render(
			createElement(PassReceipt, {
				cards: [
					{ id: "card::first", rank: 2, suit: "clubs" },
					{ id: "card::second", rank: 12, suit: "spades" },
					{ id: "card::third", rank: 14, suit: "hearts" },
				],
				onDismiss,
				senderName: "Bea",
			}),
			document.body,
		)

		expect(
			screen.getByRole("dialog", { name: "Cards received from Bea" }),
		).toBeTruthy()
		expect(screen.getByLabelText("2 of clubs").dataset.cardId).toBe(
			"card::first",
		)
		expect(screen.getByLabelText("Q of spades").dataset.cardId).toBe(
			"card::second",
		)
		expect(screen.getByLabelText("A of hearts").dataset.cardId).toBe(
			"card::third",
		)
		const button = screen.getByRole("button", {
			name: "Add cards to my hand",
		})
		await waitFor(() => {
			expect(document.activeElement).toBe(button)
		})
		expect(onDismiss).not.toHaveBeenCalled()
		fireEvent.click(button)
		expect(onDismiss).toHaveBeenCalledOnce()
	})
})
