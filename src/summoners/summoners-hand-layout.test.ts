import { describe, expect, it } from "vitest"

import { summonersHandCardLayout } from "./summoners-hand-layout.ts"

describe("summonersHandCardLayout", () => {
	it("centers a single card", () => {
		expect(summonersHandCardLayout(1, 0)).toEqual({
			angle: 0,
			left: 50,
			rise: 0,
		})
	})

	it("fans a full nine-card hand within a bounded spread", () => {
		const hand = Array.from({ length: 9 }, (_, index) =>
			summonersHandCardLayout(9, index),
		)

		expect(hand[0]?.left).toBe(8)
		expect(hand[8]?.left).toBe(92)
		expect(hand[0]?.angle).toBeLessThan(0)
		expect(hand[8]?.angle).toBeGreaterThan(0)
		expect(hand[4]).toEqual({ angle: 0, left: 50, rise: 0 })
	})

	it("keeps the fan symmetric as cards are added", () => {
		const left = summonersHandCardLayout(6, 0)
		const right = summonersHandCardLayout(6, 5)

		expect(left.left + right.left).toBe(100)
		expect(left.angle + right.angle).toBe(0)
		expect(left.rise).toBe(right.rise)
	})
})
