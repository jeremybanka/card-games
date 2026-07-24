import { fireEvent, render, screen } from "@testing-library/react"
import { createElement, type FunctionComponent } from "react"
import { describe, expect, it, vi } from "vitest"

import type {
	CompletedTrick,
	PlayerId,
	PublicGameView,
} from "./game/hearts-types.ts"
import { GameTransitions } from "./GameTransitions.tsx"

const GameTransitionsCompat = GameTransitions as unknown as FunctionComponent<
	Parameters<typeof GameTransitions>[0]
>

const me = "user::me" as PlayerId
const terra = "user::terra" as PlayerId
const trick: CompletedTrick = {
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
	it("stacks the winner last and waits for dismissal", () => {
		const onDismissTrick = vi.fn()
		render(
			createElement(GameTransitionsCompat, {
				game,
				myPlayerId: me,
				onDismissTrick,
				review: trick,
			}),
		)

		expect(
			screen.getByRole("dialog", { name: "Terra takes the trick" }),
		).toBeTruthy()
		const cards = [...document.querySelectorAll("review-card")]
		expect(cards).toHaveLength(2)
		expect(cards.at(-1)?.getAttribute("data-winner")).not.toBeNull()
		expect(cards.at(-1)?.getAttribute("aria-label")).toContain("and won")

		fireEvent.click(
			screen.getByRole("button", { name: "Continue to next trick" }),
		)
		expect(onDismissTrick).toHaveBeenCalledOnce()
	})

	it("announces the current player when no review is open", () => {
		render(
			createElement(GameTransitionsCompat, {
				game: { ...game, currentPlayerId: me },
				myPlayerId: me,
				onDismissTrick: () => {},
				review: null,
			}),
		)
		expect(screen.getByRole("status", { name: "Your turn" })).toBeTruthy()
	})
})
