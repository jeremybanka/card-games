// @vitest-environment happy-dom

import { fireEvent, screen } from "@testing-library/react"
import { createElement, render } from "preact"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type {
	CompletedTrick,
	PlayerId,
	PublicGameView,
} from "./game/hearts-types.ts"
import { GameTransitions } from "./GameTransitions.tsx"

const me = "user::me" as PlayerId
const terra = "user::terra" as PlayerId
const trick: CompletedTrick = {
	leftoverAward: null,
	plays: [
		{
			card: { id: "card::two", rank: 2, suit: "clubs" },
			playerId: me,
		},
		{
			card: { id: "card::ace", rank: 14, suit: "clubs" },
			playerId: terra,
		},
	],
	winnerId: terra,
}
const game: PublicGameView = {
	completedTricks: [trick],
	currentPlayerId: terra,
	currentTrick: [],
	deckCardIds: [],
	heartsBroken: false,
	hostId: me,
	lastTrickWinnerId: terra,
	passDirection: "across",
	passSubmittedPlayerIds: [],
	phase: "playing",
	players: [
		{
			aiModel: null,
			capturedCardIds: [],
			connected: true,
			handCardIds: [],
			id: me,
			kind: "human",
			name: "Player",
			roundPoints: 0,
			score: 0,
		},
		{
			aiModel: "gpt-5.6-terra",
			capturedCardIds: [],
			connected: true,
			handCardIds: [],
			id: terra,
			kind: "ai",
			name: "Terra",
			roundPoints: 0,
			score: 0,
		},
	],
	roomCode: "TEST",
	roundNumber: 1,
	statusMessage: "Terra takes the trick and leads.",
	trickLeaderId: terra,
	trickNumber: 1,
	winnerIds: [],
}

describe("GameTransitions", () => {
	beforeEach(() => {
		render(null, document.body)
		document.body.replaceChildren()
	})

	it("stacks the winner last and waits for dismissal", () => {
		const onDismissTrick = vi.fn()
		render(
			createElement(GameTransitions, {
				awardedLeftoverCard: null,
				game,
				myPlayerId: me,
				onDismissTrick,
				review: trick,
			}),
			document.body,
		)

		expect(
			screen.getByRole("dialog", { name: "Terra takes the trick" }),
		).toBeTruthy()
		const cards = [...document.querySelectorAll("review-card")]
		expect(cards).toHaveLength(2)
		expect(cards.at(-1)?.getAttribute("data-winner")).not.toBeNull()
		expect(cards.at(-1)?.getAttribute("aria-label")).toContain("and won")
		expect(document.querySelector("winning-halo")).toBeNull()

		fireEvent.click(
			screen.getByRole("button", { name: "Continue to next trick" }),
		)
		expect(onDismissTrick).toHaveBeenCalledOnce()
	})

	it("announces the current player when no review is open", () => {
		render(
			createElement(GameTransitions, {
				awardedLeftoverCard: null,
				game: { ...game, currentPlayerId: me },
				myPlayerId: me,
				onDismissTrick: () => {},
				review: null,
			}),
			document.body,
		)
		expect(screen.getByRole("status", { name: "Your turn" })).toBeTruthy()
	})

	it.each([
		["Loopy Night Hag", "Loopy Night Hag's\u00a0turn"],
		[
			"ExtraordinarilyLongUnbrokenPlayerName",
			"ExtraordinarilyLongUnbrokenPlayerName's\u00a0turn",
		],
	])(
		"keeps the full accessible turn label while protecting its final phrase for %s",
		(name, visualLabel) => {
			const longNameGame: PublicGameView = {
				...game,
				players: game.players.map((player) =>
					player.id === terra ? { ...player, name } : player,
				),
			}
			render(
				createElement(GameTransitions, {
					awardedLeftoverCard: null,
					game: longNameGame,
					myPlayerId: me,
					onDismissTrick: () => {},
					review: null,
				}),
				document.body,
			)

			expect(
				screen.getByRole("status", { name: `${name}'s turn` }),
			).toBeTruthy()
			expect(document.querySelector("banner-panel > strong")?.textContent).toBe(
				visualLabel,
			)
		},
	)

	it("shows the leftover card face to its recipient", () => {
		const awardedTrick: CompletedTrick = {
			...trick,
			leftoverAward: { cardId: "card::leftover", recipientId: me },
			winnerId: me,
		}
		render(
			createElement(GameTransitions, {
				awardedLeftoverCard: {
					id: "card::leftover",
					rank: 12,
					suit: "spades",
				},
				game: { ...game, completedTricks: [awardedTrick] },
				myPlayerId: me,
				onDismissTrick: () => {},
				review: awardedTrick,
			}),
			document.body,
		)

		expect(
			screen.getByLabelText("Player receives the leftover card"),
		).toBeTruthy()
		expect(screen.getByLabelText("Q of spades")).toBeTruthy()
		expect(screen.getByText("You receive the leftover card")).toBeTruthy()
		expect(screen.getByText(/The deck is now empty/)).toBeTruthy()
	})

	it("hides the leftover card face from other players", () => {
		const awardedTrick: CompletedTrick = {
			...trick,
			leftoverAward: { cardId: "card::leftover", recipientId: terra },
		}
		render(
			createElement(GameTransitions, {
				awardedLeftoverCard: null,
				game: { ...game, completedTricks: [awardedTrick] },
				myPlayerId: me,
				onDismissTrick: () => {},
				review: awardedTrick,
			}),
			document.body,
		)

		expect(
			screen.getByLabelText("Terra receives the leftover card"),
		).toBeTruthy()
		expect(screen.getByLabelText("Face-down card")).toBeTruthy()
		expect(screen.queryByText("Q")).toBeNull()
	})
})
