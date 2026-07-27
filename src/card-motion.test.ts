// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest"

import {
	cardMotionCompleteEvent,
	capturePendingCardMotion,
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
		rotation: 0,
		top: 20,
		width: 50,
		zone: "hand",
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

	it("keeps an authoritative trick card settled through later trick updates", () => {
		expect(
			planCardTransition(
				snapshot({
					face: "up",
					height: 90,
					left: 180,
					top: 220,
					width: 64,
					zone: "trick",
				}),
				snapshot({
					face: "up",
					height: 92,
					left: 179,
					top: 219,
					width: 66,
					zone: "trick",
				}),
			),
		).toEqual({ kind: "none" })
	})
})

describe("observeCardMotion", () => {
	it("moves received physical cards from the receipt into the sorted hand", async () => {
		vi.stubGlobal("matchMedia", () => ({ matches: false }))
		const animate = vi.fn(
			() => ({ finished: Promise.resolve() }) as unknown as Animation,
		)
		Object.defineProperty(HTMLElement.prototype, "animate", {
			configurable: true,
			value: animate,
		})
		const root = document.createElement("game-table")
		const receipt = document.createElement("receipt-card")
		receipt.dataset.cardId = "card::received"
		receipt.getBoundingClientRect = () =>
			({ height: 140, left: 120, top: 100, width: 100 }) as DOMRect
		root.append(receipt)
		document.body.append(root)
		const stop = observeCardMotion(root)
		const completed = vi.fn()
		root.addEventListener(cardMotionCompleteEvent, completed)

		const hand = document.createElement("player-hand")
		const destination = document.createElement("playing-card")
		destination.dataset.cardId = "card::received"
		destination.getBoundingClientRect = () =>
			({ height: 98, left: 30, top: 400, width: 70 }) as DOMRect
		hand.append(destination)
		receipt.remove()
		root.append(hand)

		await vi.waitFor(() => {
			expect(animate).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({
						transform: expect.stringContaining("translate3d(90px, -300px"),
					}),
				]),
				expect.objectContaining({ duration: 320 }),
			)
			expect(completed).toHaveBeenCalledOnce()
		})
		expect((completed.mock.calls[0] as [CustomEvent])[0].detail).toBe(
			"card::received",
		)
		stop()
	})

	it("hands a pending dragged card release position to authoritative motion", async () => {
		vi.stubGlobal("matchMedia", () => ({ matches: false }))
		const neverFinishes = new Promise<never>(() => {})
		const animate = vi.fn(
			() => ({ finished: neverFinishes }) as unknown as Animation,
		)
		Object.defineProperty(HTMLElement.prototype, "animate", {
			configurable: true,
			value: animate,
		})
		const root = document.createElement("game-table")
		root.dataset.cardRound = "1"
		root.dataset.cardGesture = "dragging"
		const hand = document.createElement("player-hand")
		const source = document.createElement("playing-card")
		source.dataset.cardId = "card::dragged"
		source.dataset.dealRound = "1"
		const sourceFace = document.createElement("card-face")
		source.append(sourceFace)
		let sourceLeft = 20
		let sourceTop = 420
		source.getBoundingClientRect = () =>
			({
				height: 100,
				left: sourceLeft,
				top: sourceTop,
				width: 72,
			}) as DOMRect
		sourceFace.getBoundingClientRect = () =>
			({
				height: 130,
				left: 105,
				top: 225,
				width: 94,
			}) as DOMRect
		hand.append(source)
		root.append(hand)
		document.body.append(root)
		const stop = observeCardMotion(root)

		sourceLeft = 120
		sourceTop = 260
		capturePendingCardMotion(root, "card::dragged")
		root.dataset.cardGesture = "pending"
		const destination = document.createElement("playing-card")
		destination.dataset.cardId = "card::dragged"
		destination.getBoundingClientRect = () =>
			({ height: 92, left: 180, top: 160, width: 66 }) as DOMRect
		const trickSlot = document.createElement("trick-slot")
		trickSlot.append(destination)
		source.remove()
		root.append(trickSlot)

		await vi.waitFor(() => {
			expect(animate).toHaveBeenCalledWith(
				[
					expect.objectContaining({
						transform: expect.stringContaining("translate3d(-75px, 65px"),
					}),
					{ transform: expect.not.stringContaining("translate3d") },
				],
				expect.objectContaining({ duration: 320 }),
			)
		})
		expect(root.dataset.lastCardMotion).toBe("move")
		expect(root.dataset.lastCardMotionId).toBe("card::dragged")
		expect(root.dataset.lastCardMotionFrom).toBe("105,225")
		expect(root.dataset.lastCardMotionTo).toBe("180,160")
		expect(root.dataset.lastLocalPlayMotionId).toBe("card::dragged")
		expect(root.dataset.lastLocalPlayMotionFrom).toBe("105,225")
		expect(root.dataset.lastLocalPlayMotionTo).toBe("180,160")
		stop()
	})

	it("settles authoritative changes immediately when motion is reduced", async () => {
		vi.stubGlobal("matchMedia", () => ({ matches: true }))
		const animate = vi.fn()
		Object.defineProperty(HTMLElement.prototype, "animate", {
			configurable: true,
			value: animate,
		})
		const root = document.createElement("game-table")
		root.dataset.cardRound = "1"
		root.dataset.cardDealActive = ""
		root.setAttribute("aria-busy", "true")
		const source = document.createElement("card-back")
		source.dataset.cardId = "card::opaque"
		source.dataset.dealRound = "1"
		root.append(source)
		document.body.append(root)
		const stop = observeCardMotion(root)

		const destination = document.createElement("playing-card")
		destination.dataset.cardId = "card::opaque"
		source.remove()
		root.append(destination)

		await vi.waitFor(() => {
			expect(root.hasAttribute("data-card-deal-active")).toBe(false)
		})
		expect(root.getAttribute("aria-busy")).toBeNull()
		expect(root.querySelector("card-flight")).toBeNull()
		expect(animate).not.toHaveBeenCalled()
		stop()
	})

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
		expect(root.dataset.lastCardMotionFace).toBe("authoritative")
		expect(root.querySelector("card-flight playing-card")).toBeNull()
		expect(HTMLElement.prototype.animate).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					opacity: 0,
					transform: "rotateY(88deg)",
				}),
			]),
			expect.anything(),
		)
		stop()
	})

	it("does not reanimate a settled trick card when the next card is played", async () => {
		vi.stubGlobal("matchMedia", () => ({ matches: false }))
		const neverFinishes = new Promise<never>(() => {})
		const animate = vi.fn(
			() => ({ finished: neverFinishes }) as unknown as Animation,
		)
		Object.defineProperty(HTMLElement.prototype, "animate", {
			configurable: true,
			value: animate,
		})
		const root = document.createElement("game-table")
		root.dataset.cardRound = "1"
		const localHand = document.createElement("player-hand")
		const localSource = document.createElement("playing-card")
		localSource.dataset.cardId = "card::local"
		localSource.dataset.dealRound = "1"
		localSource.getBoundingClientRect = () =>
			({ height: 100, left: 20, top: 420, width: 72 }) as DOMRect
		localHand.append(localSource)
		const opponentHand = document.createElement("opponent-hand")
		const opponentSource = document.createElement("card-back")
		opponentSource.dataset.cardId = "card::opponent"
		opponentSource.dataset.dealRound = "1"
		opponentSource.style.transform = "translateX(10px) rotate(3deg)"
		opponentSource.getBoundingClientRect = () =>
			({ height: 72, left: 260, top: 30, width: 54 }) as DOMRect
		opponentHand.append(opponentSource)
		root.append(localHand, opponentHand)
		document.body.append(root)
		const stop = observeCardMotion(root)

		const localDestination = document.createElement("playing-card")
		localDestination.dataset.cardId = "card::local"
		let localRect = {
			height: 92,
			left: 150,
			top: 210,
			width: 66,
		}
		localDestination.getBoundingClientRect = () => localRect as DOMRect
		localSource.remove()
		root.append(localDestination)

		await vi.waitFor(() => {
			expect(animate).toHaveBeenCalledTimes(1)
		})
		localRect = {
			height: 96,
			left: 82,
			top: 330,
			width: 69,
		}

		const opponentDestination = document.createElement("playing-card")
		opponentDestination.dataset.cardId = "card::opponent"
		opponentDestination.getBoundingClientRect = () =>
			({ height: 92, left: 220, top: 160, width: 66 }) as DOMRect
		opponentSource.remove()
		root.append(opponentDestination)

		await vi.waitFor(() => {
			expect(
				root.querySelector("card-flight[data-motion-card-id='card::opponent']"),
			).not.toBeNull()
		})
		expect(animate).toHaveBeenCalledTimes(4)
		expect(animate.mock.calls[1]).toEqual([
			expect.arrayContaining([
				expect.objectContaining({
					transform: expect.stringContaining("rotate(3deg)"),
				}),
			]),
			expect.anything(),
		])
		expect(
			animate.mock.instances.filter(
				(instance) => instance === localDestination,
			),
		).toHaveLength(1)
		stop()
	})

	it("does not reanimate a trick card after its first motion has finished", async () => {
		vi.stubGlobal("matchMedia", () => ({ matches: false }))
		const pending = new Promise<never>(() => {})
		const animate = vi.fn(function (this: HTMLElement) {
			return {
				cancel: vi.fn(),
				finished:
					this.dataset.cardId === "card::local" ? Promise.resolve() : pending,
			} as unknown as Animation
		})
		Object.defineProperty(HTMLElement.prototype, "animate", {
			configurable: true,
			value: animate,
		})
		const root = document.createElement("game-table")
		root.dataset.cardRound = "1"
		const localHand = document.createElement("player-hand")
		const localSource = document.createElement("playing-card")
		localSource.dataset.cardId = "card::local"
		localSource.dataset.dealRound = "1"
		localSource.getBoundingClientRect = () =>
			({ height: 100, left: 20, top: 420, width: 72 }) as DOMRect
		localHand.append(localSource)
		const localSlot = document.createElement("trick-slot")
		const localDestination = document.createElement("playing-card")
		localDestination.dataset.cardId = "card::local"
		let localRect = {
			height: 90,
			left: 150,
			top: 210,
			width: 64,
		}
		localDestination.getBoundingClientRect = () => localRect as DOMRect
		localSlot.append(localDestination)
		const opponentHand = document.createElement("opponent-hand")
		const opponentSource = document.createElement("card-back")
		opponentSource.dataset.cardId = "card::opponent"
		opponentSource.dataset.dealRound = "1"
		opponentSource.getBoundingClientRect = () =>
			({ height: 70, left: 260, top: 30, width: 50 }) as DOMRect
		opponentHand.append(opponentSource)
		root.append(localHand, opponentHand)
		document.body.append(root)
		const stop = observeCardMotion(root)

		localSource.remove()
		root.append(localSlot)
		await vi.waitFor(() => {
			expect(
				animate.mock.instances.filter(
					(instance) => instance === localDestination,
				),
			).toHaveLength(1)
		})
		await Promise.resolve()
		localRect = {
			height: 92,
			left: 149,
			top: 209,
			width: 66,
		}

		const opponentSlot = document.createElement("trick-slot")
		const opponentDestination = document.createElement("playing-card")
		opponentDestination.dataset.cardId = "card::opponent"
		opponentDestination.getBoundingClientRect = () =>
			({ height: 90, left: 220, top: 160, width: 64 }) as DOMRect
		opponentSlot.append(opponentDestination)
		opponentSource.remove()
		root.append(opponentSlot)

		await vi.waitFor(() => {
			expect(root.dataset.lastCardMotion).toBe("opponent-play")
		})
		expect(
			animate.mock.instances.filter(
				(instance) => instance === localDestination,
			),
		).toHaveLength(1)
		stop()
	})
})
