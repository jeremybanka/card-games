import { describe, expect, it } from "vitest"

import {
	clockwiseOpponentSeatIndices,
	clockwiseSeatOffset,
	clockwiseSeatPosition,
	passRecipientSeatIndex,
	passSenderSeatIndex,
} from "./seat-order.ts"

describe("clockwise seat order", () => {
	for (const playerCount of [2, 3, 4]) {
		for (let localSeat = 0; localSeat < playerCount; localSeat += 1) {
			it(`orders ${playerCount} players relative to local seat ${localSeat}`, () => {
				const opponents = clockwiseOpponentSeatIndices(localSeat, playerCount)
				expect(opponents).toEqual(
					Array.from(
						{ length: playerCount - 1 },
						(_, offset) => (localSeat + offset + 1) % playerCount,
					),
				)
				expect(
					opponents.map((seat) =>
						clockwiseSeatOffset(localSeat, seat, playerCount),
					),
				).toEqual(
					Array.from({ length: playerCount - 1 }, (_, index) => index + 1),
				)
			})
		}
	}

	it("projects the next four-player seat left and the previous seat right", () => {
		expect(clockwiseSeatPosition(1, 4).left).toBeLessThan(50)
		expect(clockwiseSeatPosition(3, 4).left).toBeGreaterThan(50)
	})
})

describe("pass recipient seat", () => {
	for (const playerCount of [2, 3, 4]) {
		for (let sender = 0; sender < playerCount; sender += 1) {
			it(`resolves every direction for ${playerCount} players from seat ${sender}`, () => {
				const expectedRecipients = {
					across: (sender + (playerCount === 4 ? 2 : 1)) % playerCount,
					hold: sender,
					left: (sender + 1) % playerCount,
					right: (sender - 1 + playerCount) % playerCount,
				} as const
				for (const direction of ["left", "right", "across", "hold"] as const) {
					const recipient = passRecipientSeatIndex(
						sender,
						playerCount,
						direction,
					)
					expect(recipient).toBe(expectedRecipients[direction])
					expect(passSenderSeatIndex(recipient, playerCount, direction)).toBe(
						sender,
					)
				}
			})
		}
	}
})
