import { describe, expect, it } from "vitest"

import {
	advanceCardGesture,
	cardGesturePhase,
	compactHandCardLayout,
	draggedCardTransform,
	dragTranslationFromPointer,
	handCardLayout,
	HAND_OUTWARD_CORRIDOR_BASE,
	HAND_OUTWARD_CORRIDOR_SLOPE,
	HAND_SCRUBBING_BAND_TOP,
	passSelectionAfterDrop,
} from "./card-hand-layout.ts"

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

	it.each([0, 1, 2, 7, 13])(
		"keeps a compact %i-card hand in the same bounded coordinate space",
		(cardCount) => {
			const layouts = Array.from({ length: cardCount }, (_, index) =>
				compactHandCardLayout(cardCount, index),
			)
			expect(layouts.every(({ left }) => left >= 8 && left <= 92)).toBe(true)
			expect(layouts.every(({ angle }) => Math.abs(angle) <= 15.5)).toBe(true)
			expect(layouts.every(({ rise }) => rise >= 0)).toBe(true)
		},
	)

	it("uses a centered, gentler fan for a full opponent hand", () => {
		const layouts = Array.from({ length: 13 }, (_, index) =>
			compactHandCardLayout(13, index),
		)
		expect(layouts[0]).toEqual({
			angle: -7.153846153846153,
			left: 8,
			rise: 1.7999999999999998,
		})
		expect(layouts[6]).toEqual({ angle: 0, left: 50, rise: 0 })
		expect(layouts.at(-1)).toEqual({
			angle: 7.153846153846153,
			left: 92,
			rise: 1.7999999999999998,
		})
	})

	it("does not change pass cards without a valid destination", () => {
		const selection = ["card-a", "card-b"]
		expect(passSelectionAfterDrop(selection, "card-c", "hand", null)).toEqual(
			selection,
		)
		expect(passSelectionAfterDrop(selection, "card-a", "pass", null)).toEqual(
			selection,
		)
	})

	it("moves cards between the hand and the explicit pass destination", () => {
		expect(passSelectionAfterDrop([], "card-a", "hand", "pass")).toEqual([
			"card-a",
		])
		expect(
			passSelectionAfterDrop(["card-a"], "card-b", "hand", "pass", 0),
		).toEqual(["card-b", "card-a"])
		expect(
			passSelectionAfterDrop(["card-a", "card-b"], "card-a", "pass", "hand"),
		).toEqual(["card-b"])
	})

	it("caps and reorders the pass destination without changing card identity", () => {
		const full = ["card-a", "card-b", "card-c"]
		expect(passSelectionAfterDrop(full, "card-d", "hand", "pass")).toEqual(full)
		expect(passSelectionAfterDrop(full, "card-c", "pass", "pass", 0)).toEqual([
			"card-c",
			"card-a",
			"card-b",
		])
	})

	it("promotes an upward pick into a card drag", () => {
		expect(cardGesturePhase(HAND_SCRUBBING_BAND_TOP)).toBe("picking")
		expect(cardGesturePhase(HAND_SCRUBBING_BAND_TOP - 1)).toBe("dragging")
	})

	it("scrubs cards only while the gesture stays inside the picking band", () => {
		const scrubbed = advanceCardGesture(
			{ cardId: "card-a", phase: "picking" },
			"card-b",
			{ x: 30, y: 0 },
		)
		expect(scrubbed).toEqual({ cardId: "card-b", phase: "picking" })
	})

	it.each(["left", "center", "right"])(
		"preserves the picked %s card through a diagonal outward corridor",
		() => {
			expect(
				advanceCardGesture(
					{ cardId: "picked-card", phase: "picking" },
					"intersected-neighbor",
					{ x: 34, y: -24 },
				),
			).toEqual({ cardId: "picked-card", phase: "picking" })
		},
	)

	it("allows an unmistakably lateral scrub before an outward drag", () => {
		const lateral = advanceCardGesture(
			{ cardId: "card-a", phase: "picking" },
			"card-b",
			{ x: 60, y: -10 },
		)
		expect(lateral).toEqual({ cardId: "card-b", phase: "picking" })
		expect(
			advanceCardGesture(lateral, "card-c", {
				x: HAND_OUTWARD_CORRIDOR_BASE,
				y: -20,
			}),
		).toEqual({ cardId: "card-b", phase: "picking" })
	})

	it("uses an inclusive, deterministic corridor boundary", () => {
		const y = -20
		const boundary =
			HAND_OUTWARD_CORRIDOR_BASE + Math.abs(y) * HAND_OUTWARD_CORRIDOR_SLOPE
		const gesture = { cardId: "card-a", phase: "picking" } as const
		expect(
			advanceCardGesture(gesture, "card-b", { x: boundary, y }).cardId,
		).toBe("card-a")
		expect(
			advanceCardGesture(gesture, "card-b", { x: boundary + 0.01, y }).cardId,
		).toBe("card-b")
	})

	it("locks the current card when leaving the picking band", () => {
		const dragged = advanceCardGesture(
			{ cardId: "card-b", phase: "picking" },
			"card-c",
			{ x: 10, y: HAND_SCRUBBING_BAND_TOP - 1 },
		)
		expect(dragged).toEqual({ cardId: "card-b", phase: "dragging" })
		expect(
			advanceCardGesture(dragged, "card-z", {
				x: 100,
				y: HAND_SCRUBBING_BAND_TOP + 100,
			}),
		).toBe(dragged)
	})

	it("counter-rotates and enlarges a committed card from either fan edge", () => {
		expect(draggedCardTransform(-12, { x: 3, y: -18 })).toBe(
			"translate3d(3px, -18px, 0) rotate(12deg) scale(1.06)",
		)
		expect(draggedCardTransform(12, { x: -3, y: -18 })).toBe(
			"translate3d(-3px, -18px, 0) rotate(-12deg) scale(1.06)",
		)
		expect(draggedCardTransform(0, { x: 0, y: -18 })).toBe(
			"translate3d(0px, -18px, 0) rotate(0deg) scale(1.06)",
		)
	})

	it("projects pointer movement into the rotated hand-card coordinates", () => {
		const pointerDelta = { x: 24, y: -36 }
		for (const angle of [-12, 0, 12]) {
			const local = dragTranslationFromPointer(
				angle,
				{ x: 0, y: -18 },
				pointerDelta,
			)
			const radians = (angle * Math.PI) / 180
			const viewportDelta = {
				x:
					(local.x - 0) * Math.cos(radians) -
					(local.y + 18) * Math.sin(radians),
				y:
					(local.x - 0) * Math.sin(radians) +
					(local.y + 18) * Math.cos(radians),
			}
			expect(viewportDelta.x).toBeCloseTo(pointerDelta.x)
			expect(viewportDelta.y).toBeCloseTo(pointerDelta.y)
		}
	})
})
