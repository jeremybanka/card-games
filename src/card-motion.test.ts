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

	it("classifies a face-up hand card entering the trick as a local play", () => {
		expect(
			planCardTransition(
				snapshot({ face: "up", zone: "hand" }),
				snapshot({ face: "up", left: 180, top: 220, zone: "trick" }),
			),
		).toEqual({ kind: "local-play" })
	})

	it("prioritizes an explicit receipt transfer over current-round deal metadata", () => {
		expect(
			planCardTransition(
				snapshot({
					dealRound: null,
					face: "up",
					left: 120,
					top: 100,
					zone: "receipt",
				}),
				snapshot({
					dealIndex: 8,
					dealRound: "4",
					face: "up",
					left: 30,
					top: 400,
					zone: "hand",
				}),
			),
		).toEqual({ kind: "receipt-transfer" })
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
	it("captures a receipt origin before removal and transfers into a rendered dealt hand card", async () => {
		vi.stubGlobal("matchMedia", () => ({ matches: false }))
		const animate = vi.fn(
			() => ({ finished: Promise.resolve() }) as unknown as Animation,
		)
		Object.defineProperty(HTMLElement.prototype, "animate", {
			configurable: true,
			value: animate,
		})
		const root = document.createElement("game-table")
		root.dataset.cardRound = "4"
		root.dataset.motionReadyRound = "4"
		document.body.append(root)
		const stop = observeCardMotion(root)
		const completed = vi.fn()
		root.addEventListener(cardMotionCompleteEvent, completed)

		const receipt = document.createElement("receipt-card")
		receipt.dataset.cardId = "card::received"
		const readReceiptRect = vi.fn(() => {
			expect(receipt.isConnected).toBe(true)
			return { height: 140, left: 120, top: 100, width: 100 } as DOMRect
		})
		receipt.getBoundingClientRect = readReceiptRect
		root.append(receipt)
		capturePendingCardMotion(root, "card::received")
		expect(readReceiptRect).toHaveBeenCalledOnce()

		const hand = document.createElement("player-hand")
		const destination = document.createElement("playing-card")
		destination.dataset.cardId = "card::received"
		destination.dataset.dealIndex = "8"
		destination.dataset.dealRound = "4"
		const readDestinationRect = vi.fn(() => {
			expect(destination.isConnected).toBe(true)
			return { height: 98, left: 30, top: 400, width: 70 } as DOMRect
		})
		destination.getBoundingClientRect = readDestinationRect
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
				expect.objectContaining({ duration: 480 }),
			)
			expect(completed).toHaveBeenCalledOnce()
		})
		expect(readDestinationRect).toHaveBeenCalled()
		expect(root.dataset.lastCardMotion).toBe("receipt-transfer")
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
		hand.style.transform = "rotate(12deg)"
		const source = document.createElement("playing-card")
		source.dataset.cardId = "card::dragged"
		source.dataset.dealRound = "1"
		source.style.transform =
			"translate3d(100px, -160px, 0) rotate(-8deg) scale(1.1)"
		const sourceFace = document.createElement("card-face")
		sourceFace.style.transform = "translateY(-18px) scale(1.3)"
		Object.defineProperty(sourceFace, "offsetWidth", { value: 72 })
		Object.defineProperty(sourceFace, "offsetHeight", { value: 100 })
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
				height: 149.833,
				left: 95.024,
				top: 225,
				width: 112.685,
			}) as DOMRect
		hand.append(source)
		root.append(hand)
		document.body.append(root)
		const stop = observeCardMotion(root)

		sourceLeft = 120
		sourceTop = 260
		capturePendingCardMotion(root, "card::dragged")
		root.dataset.cardGesture = "pending"
		const unrelatedUpdate = document.createElement("turn-banner")
		root.append(unrelatedUpdate)
		await vi.waitFor(() => {
			expect(root.dataset.lastPendingCardMotionId).toBe("card::dragged")
		})
		expect(animate).not.toHaveBeenCalled()

		const destination = document.createElement("playing-card")
		destination.dataset.cardId = "card::dragged"
		destination.getBoundingClientRect = () =>
			({ height: 92, left: 180, top: 160, width: 66 }) as DOMRect
		const trickSlot = document.createElement("trick-slot")
		trickSlot.append(destination)
		source.remove()
		root.append(trickSlot)

		await vi.waitFor(() => {
			expect(animate).toHaveBeenCalledOnce()
		})
		const [keyframes, options] = animate.mock.calls[0] as unknown as [
			Keyframe[],
			KeyframeAnimationOptions,
		]
		const initialTransform = String(keyframes[0]?.transform)
		const transformParts =
			/translate3d\(([^p]+)px, ([^p]+)px, 0\) rotate\(([^d]+)deg\) scale\(([^,]+), ([^)]+)\)/.exec(
				initialTransform,
			)
		expect(transformParts).not.toBeNull()
		expect(Number(transformParts?.[1])).toBeCloseTo(-75)
		expect(Number(transformParts?.[2])).toBeCloseTo(65)
		expect(Number(transformParts?.[3])).toBeCloseTo(4)
		expect(Number(transformParts?.[4])).toBeCloseTo(1.56)
		expect(Number(transformParts?.[5])).toBeCloseTo(1.55435)
		expect(keyframes[0]?.transformOrigin).toBe("top left")
		expect(keyframes[1]?.transformOrigin).toBe("top left")
		expect(options).toMatchObject({ duration: 360, fill: "backwards" })
		expect(root.dataset.lastCardMotion).toBe("local-play")
		expect(root.dataset.lastCardMotionId).toBe("card::dragged")
		const [fromX, fromY] = root.dataset.lastCardMotionFrom
			?.split(",")
			.map(Number) ?? [NaN, NaN]
		expect(fromX).toBeCloseTo(105)
		expect(fromY).toBeCloseTo(225)
		expect(root.dataset.lastCardMotionTo).toBe("180,160")
		expect(root.dataset.lastLocalPlayMotionId).toBe("card::dragged")
		expect(root.dataset.lastLocalPlayMotionFrom).toBe(
			root.dataset.lastCardMotionFrom,
		)
		expect(root.dataset.lastLocalPlayMotionTo).toBe("180,160")
		const motionSizes =
			/([^x]+)x([^-]+)->([^x]+)x(.+)/.exec(
				root.dataset.lastLocalPlayMotionSize ?? "",
			) ?? []
		expect(Number(motionSizes[1])).toBeCloseTo(102.96)
		expect(Number(motionSizes[2])).toBeCloseTo(143)
		expect(Number(motionSizes[3])).toBeCloseTo(66)
		expect(Number(motionSizes[4])).toBeCloseTo(92)
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
