import { describe, expect, it } from "vitest"

import type {
	CompletedTrick,
	PlayerId,
	PublicGameView,
} from "./game/hearts-types.ts"
import {
	completedTrickKey,
	orderedTrickReviewPlays,
	shouldAutoDismissTrickReview,
} from "./game-presentation.ts"

const me = "user::me" as PlayerId
const other = "user::other" as PlayerId
const trick: CompletedTrick = {
	plays: [
		{
			card: { id: "card::low", rank: 2, suit: "clubs" },
			playerId: me,
		},
		{
			card: { id: "card::high", rank: 14, suit: "clubs" },
			playerId: other,
		},
	],
	winnerId: other,
}

function game(overrides: Partial<PublicGameView> = {}): PublicGameView {
	return {
		completedTricks: [trick],
		currentPlayerId: other,
		currentTrick: [],
		heartsBroken: false,
		hostId: me,
		lastTrickWinnerId: other,
		passDirection: "across",
		passSubmittedPlayerIds: [],
		phase: "playing",
		players: [],
		roomCode: "TEST",
		roundNumber: 2,
		statusMessage: "Other takes the trick and leads.",
		trickLeaderId: other,
		trickNumber: 1,
		winnerIds: [],
		...overrides,
	}
}

describe("game presentation", () => {
	it("gives every completed trick a stable round-scoped key", () => {
		expect(completedTrickKey(game())).toBe("TEST:round-2-trick-1")
		expect(completedTrickKey(game({ completedTricks: [] }))).toBeNull()
	})

	it("lands the winning card last so it is visually on top", () => {
		expect(orderedTrickReviewPlays(trick).at(-1)?.playerId).toBe(other)
	})

	it("auto-dismisses when play reaches the viewer", () => {
		expect(
			shouldAutoDismissTrickReview(
				game({
					currentPlayerId: me,
					currentTrick: [
						{
							card: { id: "card::lead", rank: 3, suit: "clubs" },
							playerId: other,
						},
					],
				}),
				me,
				trick,
			),
		).toBe(true)
	})

	it("waits for the trick taker to dismiss before leading", () => {
		const wonTrick = { ...trick, winnerId: me }
		expect(
			shouldAutoDismissTrickReview(
				game({
					currentPlayerId: me,
					lastTrickWinnerId: me,
					trickLeaderId: me,
				}),
				me,
				wonTrick,
			),
		).toBe(false)
	})
})
