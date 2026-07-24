import { useEffect } from "preact/hooks"

export type CardSnapshot = {
	dealIndex: number | null
	dealRound: string | null
	face: "down" | "up"
	height: number
	left: number
	top: number
	width: number
}

export type CardTransition =
	| {
			delay: number
			kind: "deal"
	  }
	| {
			kind: "move"
	  }
	| {
			kind: "opponent-play"
	  }
	| {
			kind: "none"
	  }

const cardSelector = "playing-card[data-card-id], card-back[data-card-id]"
const dealStepMilliseconds = 24

function cardFace(element: HTMLElement): CardSnapshot["face"] {
	return element.matches("playing-card") ? "up" : "down"
}

function dataNumber(value: string | undefined): number | null {
	if (value === undefined) return null
	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : null
}

export function planCardTransition(
	before: CardSnapshot | undefined,
	after: CardSnapshot,
): CardTransition {
	if (
		after.dealRound !== null &&
		(before === undefined || before.dealRound !== after.dealRound)
	) {
		return {
			delay: Math.max(0, after.dealIndex ?? 0) * dealStepMilliseconds,
			kind: "deal",
		}
	}
	if (before === undefined) return { kind: "none" }
	if (before.face === "down" && after.face === "up") {
		return { kind: "opponent-play" }
	}
	const moved =
		Math.hypot(before.left - after.left, before.top - after.top) > 0.5 ||
		Math.abs(before.width / Math.max(after.width, 1) - 1) > 0.01 ||
		Math.abs(before.height / Math.max(after.height, 1) - 1) > 0.01
	return { kind: moved ? "move" : "none" }
}

function takeSnapshots(root: HTMLElement): Map<string, CardSnapshot> {
	const snapshots = new Map<string, CardSnapshot>()
	for (const element of root.querySelectorAll<HTMLElement>(cardSelector)) {
		const cardId = element.dataset.cardId
		if (cardId === undefined) continue
		const rect = element.getBoundingClientRect()
		snapshots.set(cardId, {
			dealIndex: dataNumber(element.dataset.dealIndex),
			dealRound: element.dataset.dealRound ?? null,
			face: cardFace(element),
			height: rect.height,
			left: rect.left,
			top: rect.top,
			width: rect.width,
		})
	}
	return snapshots
}

function settledTransform(element: HTMLElement): string {
	const transform = getComputedStyle(element).transform
	return transform === "none" ? "none" : transform
}

function animateDeal(
	element: HTMLElement,
	after: CardSnapshot,
	deck: DOMRect,
	delay: number,
): Animation {
	const deltaX = deck.left + deck.width / 2 - (after.left + after.width / 2)
	const deltaY = deck.top + deck.height / 2 - (after.top + after.height / 2)
	const scaleX = deck.width / Math.max(after.width, 1)
	const scaleY = deck.height / Math.max(after.height, 1)
	return element.animate(
		[
			{
				opacity: 0,
				transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY}) rotateY(88deg)`,
			},
			{ opacity: 1, offset: 0.22 },
			{ opacity: 1, transform: settledTransform(element) },
		],
		{
			delay,
			duration: 380,
			easing: "cubic-bezier(.18,.72,.2,1)",
			fill: "backwards",
		},
	)
}

function animateMove(
	element: HTMLElement,
	before: CardSnapshot,
	after: CardSnapshot,
): Animation {
	const deltaX = before.left - after.left
	const deltaY = before.top - after.top
	const scaleX = before.width / Math.max(after.width, 1)
	const scaleY = before.height / Math.max(after.height, 1)
	return element.animate(
		[
			{
				transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})`,
			},
			{ transform: settledTransform(element) },
		],
		{
			duration: 320,
			easing: "cubic-bezier(.2,.75,.25,1)",
		},
	)
}

function animateOpponentPlay(
	root: HTMLElement,
	element: HTMLElement,
	before: CardSnapshot,
	after: CardSnapshot,
): Animation {
	const flight = document.createElement("card-flight")
	const flyingCard = element.cloneNode(true) as HTMLElement
	const flyingBack = document.createElement("flight-back")
	flyingCard.removeAttribute("data-card-id")
	flyingCard.querySelector("button")?.setAttribute("tabindex", "-1")
	flight.setAttribute("aria-hidden", "true")
	flight.dataset.motionKind = "opponent-play"
	flight.dataset.motionCardId = element.dataset.cardId
	flight.style.left = `${before.left}px`
	flight.style.top = `${before.top}px`
	flight.style.width = `${before.width}px`
	flight.style.height = `${before.height}px`
	flight.append(flyingBack)
	flight.append(flyingCard)
	root.append(flight)

	element.style.opacity = "0"
	const deltaX = after.left - before.left
	const deltaY = after.top - before.top
	const scaleX = after.width / Math.max(before.width, 1)
	const scaleY = after.height / Math.max(before.height, 1)
	const animation = flight.animate(
		[
			{ transform: "translate3d(0, 0, 0) scale(1)" },
			{
				offset: 0.72,
				transform: `translate3d(${deltaX * 0.82}px, ${deltaY * 0.82}px, 0) scale(${1 + (scaleX - 1) * 0.72}, ${1 + (scaleY - 1) * 0.72})`,
			},
			{
				transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})`,
			},
		],
		{
			duration: 440,
			easing: "cubic-bezier(.2,.72,.2,1)",
		},
	)
	flyingCard.animate(
		[
			{ opacity: 0, transform: "rotateY(88deg)" },
			{ opacity: 0, offset: 0.56, transform: "rotateY(88deg)" },
			{ opacity: 1, transform: "rotateY(0deg)" },
		],
		{ duration: 440, easing: "ease-in-out", fill: "both" },
	)
	flyingBack.animate(
		[
			{ opacity: 1, transform: "rotateY(0deg)" },
			{ opacity: 1, offset: 0.56, transform: "rotateY(0deg)" },
			{ opacity: 0, transform: "rotateY(-88deg)" },
		],
		{ duration: 440, easing: "ease-in-out", fill: "both" },
	)
	const finishFlight = (): void => {
		element.style.opacity = ""
		flight.remove()
	}
	void animation.finished.then(finishFlight, finishFlight)
	return animation
}

function animateCardChanges(
	root: HTMLElement,
	previous: Map<string, CardSnapshot>,
): Map<string, CardSnapshot> {
	const current = takeSnapshots(root)
	if (
		root.dataset.cardGesture !== undefined ||
		matchMedia("(prefers-reduced-motion: reduce)").matches
	) {
		root.dataset.motionReadyRound = root.dataset.cardRound ?? ""
		root.removeAttribute("data-card-deal-active")
		root.removeAttribute("aria-busy")
		return current
	}

	const deck = root.querySelector<HTMLElement>(
		"[data-card-motion-origin='deck']",
	)
	const deckRect = deck?.getBoundingClientRect()
	const dealAnimations: Animation[] = []
	let plannedDealCards = 0
	for (const element of root.querySelectorAll<HTMLElement>(cardSelector)) {
		const cardId = element.dataset.cardId
		if (cardId === undefined) continue
		const before = previous.get(cardId)
		const after = current.get(cardId)
		if (after === undefined) continue
		const transition = planCardTransition(before, after)
		if (typeof element.animate !== "function") continue
		switch (transition.kind) {
			case "deal":
				if (
					deckRect !== undefined &&
					root.dataset.cardRound !== root.dataset.motionReadyRound
				) {
					plannedDealCards += 1
					dealAnimations.push(
						animateDeal(element, after, deckRect, transition.delay),
					)
				}
				break
			case "move":
				if (before !== undefined) animateMove(element, before, after)
				break
			case "opponent-play":
				if (before !== undefined) {
					root.dataset.lastCardMotion = "opponent-play"
					root.dataset.lastCardMotionId = cardId
					animateOpponentPlay(root, element, before, after)
				}
				break
			case "none":
				break
		}
	}
	if (dealAnimations.length > 0) {
		const dealGeneration = Number(root.dataset.cardDealGeneration ?? "0") + 1
		root.dataset.cardDealGeneration = String(dealGeneration)
		root.dataset.lastCardMotion = "deal"
		root.dataset.lastDealCount = String(plannedDealCards)
		root.dataset.cardDealActive = ""
		root.setAttribute("aria-busy", "true")
		void Promise.allSettled(
			dealAnimations.map((animation) => animation.finished),
		).then(() => {
			if (root.dataset.cardDealGeneration !== String(dealGeneration)) return
			root.dataset.motionReadyRound = root.dataset.cardRound ?? ""
			root.removeAttribute("data-card-deal-active")
			root.removeAttribute("aria-busy")
		})
	} else if (root.dataset.cardRound !== root.dataset.motionReadyRound) {
		root.dataset.motionReadyRound = root.dataset.cardRound ?? ""
	}
	return current
}

export function observeCardMotion(root: HTMLElement): () => void {
	root.dataset.motionReadyRound = root.dataset.cardRound ?? ""
	let snapshots = takeSnapshots(root)
	const animateMutation = (): void => {
		snapshots = animateCardChanges(root, snapshots)
	}
	const observer = new MutationObserver(animateMutation)
	observer.observe(root, {
		attributeFilter: ["data-card-round"],
		attributes: true,
		childList: true,
		subtree: true,
	})
	return () => {
		observer.disconnect()
	}
}

export function useCardMotion(root: HTMLElement | null): void {
	useEffect(() => (root === null ? undefined : observeCardMotion(root)), [root])
}
