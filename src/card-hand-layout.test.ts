import { describe, expect, it } from "vitest"

import { cardGesturePhase, handCardLayout } from "./card-hand-layout.ts"

describe("card hand layout", () => {
	it("keeps a full two-player hand inside a bounded fan", () => {
		const layouts = Array.from({ length: 26 }, (_, index) =>
			handCardLayout(26, index),
		)
		expect(layouts[0]?.left).toBe(8)
		expect(layouts.at(-1)?.left).toBe(92)
		expect(layouts[0]?.angle).toBeLessThan(0)
		expect(layouts.at(-1)?.angle).toBeGreaterThan(0)
		expect(layouts.every(({ left }) => left >= 8 && left <= 92)).toBe(true)
	})

	it("clusters small hands near the center instead of stretching them", () => {
		expect(handCardLayout(1, 0)).toEqual({
			angle: 0,
			left: 50,
			rise: 0,
		})
		expect([0, 1].map((index) => handCardLayout(2, index).left)).toEqual([
			43, 57,
		])
	})

	it("promotes an upward pick into a card drag", () => {
		expect(cardGesturePhase(-28)).toBe("picking")
		expect(cardGesturePhase(-29)).toBe("dragging")
	})
})
