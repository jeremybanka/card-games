// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest"

import {
	type CardSnapshot,
	observeCardMotion,
	planCardTransition,
} from "./card-motion.ts"

afterEach(() => {
	document.body.replaceChildren()
	Reflect.deleteProperty(HTMLElement.prototype, "animate")
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

function snapshot(overrides: Partial<CardSnapshot> = {}): CardSnapshot {
	return {
		dealIndex: null,
		dealRound: null,
		face: "down",
		height: 70,
		left: 10,
		top: 20,
		width: 50,
		...overrides,
	}
}

describe("planCardTransition", () => {
	it("deals a newly authorized physical card in round-robin order", () => {
		expect(
			planCardTransition(
				undefined,
				snapshot({ dealIndex: 7, dealRound: "2", face: "up" }),
			),
		).toEqual({ delay: 168, kind: "deal" })
	})

	it("redeals a captured physical card when its round changes", () => {
		expect(
			planCardTransition(
				snapshot({ dealRound: "1" }),
				snapshot({ dealIndex: 3, dealRound: "2" }),
			),
		).toEqual({ delay: 72, kind: "deal" })
	})

	it("recognizes a face-down opponent card becoming a public trick card", () => {
		expect(
			planCardTransition(
				snapshot({ dealRound: "1" }),
				snapshot({
					dealRound: null,
					face: "up",
					height: 90,
					left: 180,
					top: 220,
					width: 64,
				}),
			),
		).toEqual({ kind: "opponent-play" })
	})

	it("does not replay a deal while cards settle within the same round", () => {
		expect(
			planCardTransition(
				snapshot({ dealRound: "2" }),
				snapshot({ dealRound: "2", left: 24 }),
			),
		).toEqual({ kind: "move" })
	})
})

describe("observeCardMotion", () => {
	it("keeps an opponent flight alive when the authoritative trick advances", async () => {
		vi.stubGlobal("matchMedia", () => ({ matches: false }))
		const neverFinishes = new Promise<never>(() => {})
		Object.defineProperty(HTMLElement.prototype, "animate", {
			configurable: true,
			value: vi.fn(() => ({ finished: neverFinishes }) as unknown as Animation),
		})
		const root = document.createElement("game-table")
		root.dataset.cardRound = "1"
		const hand = document.createElement("opponent-hand")
		const source = document.createElement("card-back")
		source.dataset.cardId = "card::opaque"
		source.dataset.dealRound = "1"
		source.getBoundingClientRect = () =>
			({ height: 70, left: 10, top: 20, width: 50 }) as DOMRect
		hand.append(source)
		root.append(hand)
		document.body.append(root)
		const stop = observeCardMotion(root)

		const destination = document.createElement("playing-card")
		destination.dataset.cardId = "card::opaque"
		destination.getBoundingClientRect = () =>
			({ height: 90, left: 180, top: 220, width: 64 }) as DOMRect
		source.remove()
		root.append(destination)

		await vi.waitFor(() => {
			expect(
				root.querySelector("card-flight[data-motion-card-id='card::opaque']"),
			).not.toBeNull()
		})
		destination.remove()
		expect(
			root.querySelector("card-flight[data-motion-card-id='card::opaque']"),
		).not.toBeNull()
		stop()
	})
})
