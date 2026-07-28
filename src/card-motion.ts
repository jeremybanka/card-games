import { useEffect } from "preact/hooks"

export type CardSnapshot = {
	dealIndex: number | null
	dealRound: string | null
	face: "down" | "up"
	height: number
	left: number
	rotation: number
	top: number
	width: number
	zone: "hand" | "other" | "receipt" | "taken" | "trick"
}

export type CardTransition =
	| {
			delay: number
			kind: "deal"
	  }
	| {
			kind: "local-play"
	  }
	| {
			kind: "move"
	  }
	| {
			kind: "opponent-play"
	  }
	| {
			kind: "receipt-transfer"
	  }
	| {
			kind: "none"
	  }

const cardSelector =
	"playing-card[data-card-id], card-back[data-card-id], receipt-card[data-card-id]"
const dealStepMilliseconds = 24
const opponentPlayDurationMilliseconds = 520
const capturePendingCardEvent = "wayfarer:capture-pending-card"
export const cardMotionCompleteEvent = "wayfarer:card-motion-complete"

function announceMotionComplete(root: HTMLElement, cardId: string): void {
	root.dispatchEvent(
		new CustomEvent<string>(cardMotionCompleteEvent, { detail: cardId }),
	)
}

export function capturePendingCardMotion(
	root: HTMLElement,
	cardId: string,
): void {
	root.dispatchEvent(
		new CustomEvent<string>(capturePendingCardEvent, { detail: cardId }),
	)
}

function cardFace(element: HTMLElement): CardSnapshot["face"] {
	return element.matches("playing-card, receipt-card") ? "up" : "down"
}

function dataNumber(value: string | undefined): number | null {
	if (value === undefined) return null
	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : null
}

function rotationDegrees(element: HTMLElement): number {
	const transform = element.style.transform
	const match = /rotate\((-?\d+(?:\.\d+)?)deg\)/.exec(transform)
	return match === null ? 0 : Number(match[1])
}

type TransformMetrics = {
	rotation: number
	scaleX: number
	scaleY: number
}

function elementTransformMetrics(element: HTMLElement): TransformMetrics {
	const transform = getComputedStyle(element).transform
	if (transform === "none") return { rotation: 0, scaleX: 1, scaleY: 1 }
	if (typeof DOMMatrixReadOnly === "function") {
		try {
			const matrix = new DOMMatrixReadOnly(transform)
			return {
				rotation: (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI,
				scaleX: Math.hypot(matrix.a, matrix.b),
				scaleY: Math.hypot(matrix.c, matrix.d),
			}
		} catch {
			// Test DOMs can expose DOMMatrixReadOnly without parsing CSS functions.
		}
	}
	const matrix = /^matrix\(([^)]+)\)$/.exec(transform)
	if (matrix !== null) {
		const [a = 1, b = 0, c = 0, d = 1] = (matrix[1] ?? "")
			.split(",")
			.map(Number)
		return {
			rotation: (Math.atan2(b, a) * 180) / Math.PI,
			scaleX: Math.hypot(a, b),
			scaleY: Math.hypot(c, d),
		}
	}
	const matrix3d = /^matrix3d\(([^)]+)\)$/.exec(transform)
	if (matrix3d !== null) {
		const values = (matrix3d[1] ?? "").split(",").map(Number)
		const a = values[0] ?? 1
		const b = values[1] ?? 0
		const c = values[4] ?? 0
		const d = values[5] ?? 1
		return {
			rotation: (Math.atan2(b, a) * 180) / Math.PI,
			scaleX: Math.hypot(a, b),
			scaleY: Math.hypot(c, d),
		}
	}
	const rotation = /rotate\((-?\d+(?:\.\d+)?)deg\)/.exec(transform)
	const scale = /scale\(([^)]+)\)/.exec(transform)
	const [scaleX = 1, scaleY = scaleX] = (scale?.[1] ?? "")
		.split(/,\s*|\s+/)
		.filter(Boolean)
		.map(Number)
	return {
		rotation: rotation === null ? 0 : Number(rotation[1]),
		scaleX,
		scaleY,
	}
}

function renderedTransformMetrics(element: HTMLElement): TransformMetrics {
	let rotation = 0
	let scaleX = 1
	let scaleY = 1
	let current: HTMLElement | null = element
	while (current !== null) {
		const metrics = elementTransformMetrics(current)
		rotation += metrics.rotation
		scaleX *= metrics.scaleX
		scaleY *= metrics.scaleY
		current = current.parentElement
	}
	return { rotation, scaleX, scaleY }
}

function renderedCardSnapshot(
	element: HTMLElement,
	rect: DOMRect,
): Pick<CardSnapshot, "height" | "left" | "rotation" | "top" | "width"> {
	const metrics = renderedTransformMetrics(element)
	const baseWidth = element.offsetWidth
	const baseHeight = element.offsetHeight
	if (baseWidth <= 0 || baseHeight <= 0) {
		return {
			height: rect.height,
			left: rect.left,
			rotation: 0,
			top: rect.top,
			width: rect.width,
		}
	}
	const width = baseWidth * metrics.scaleX
	const height = baseHeight * metrics.scaleY
	const radians = (metrics.rotation * Math.PI) / 180
	const horizontalX = width * Math.cos(radians)
	const horizontalY = width * Math.sin(radians)
	const verticalX = -height * Math.sin(radians)
	const verticalY = height * Math.cos(radians)
	const minimumX = Math.min(0, horizontalX, verticalX, horizontalX + verticalX)
	const minimumY = Math.min(0, horizontalY, verticalY, horizontalY + verticalY)
	return {
		height,
		left: rect.left - minimumX,
		rotation: metrics.rotation,
		top: rect.top - minimumY,
		width,
	}
}

function cardMotionZone(element: HTMLElement): CardSnapshot["zone"] {
	if (element.matches("receipt-card")) return "receipt"
	if (element.closest("trick-slot") !== null) return "trick"
	if (element.closest("player-hand, opponent-hand") !== null) return "hand"
	if (element.closest("taken-stack") !== null) return "taken"
	return "other"
}

function snapshotCard(
	element: HTMLElement,
	useRenderedFace = false,
): CardSnapshot {
	const renderedElement = useRenderedFace
		? (element.querySelector<HTMLElement>("card-face") ?? element)
		: element
	const rect = renderedElement.getBoundingClientRect()
	const rendered = useRenderedFace
		? renderedCardSnapshot(renderedElement, rect)
		: null
	const width = useRenderedFace
		? (rendered?.width ?? rect.width)
		: renderedElement.offsetWidth || rect.width
	const height = useRenderedFace
		? (rendered?.height ?? rect.height)
		: renderedElement.offsetHeight || rect.height
	return {
		dealIndex: dataNumber(element.dataset.dealIndex),
		dealRound: element.dataset.dealRound ?? null,
		face: cardFace(element),
		height,
		left: useRenderedFace
			? (rendered?.left ?? rect.left)
			: rect.left + (rect.width - width) / 2,
		rotation: useRenderedFace
			? (rendered?.rotation ?? 0)
			: rotationDegrees(element),
		top: useRenderedFace
			? (rendered?.top ?? rect.top)
			: rect.top + (rect.height - height) / 2,
		width,
		zone: cardMotionZone(element),
	}
}

export function planCardTransition(
	before: CardSnapshot | undefined,
	after: CardSnapshot,
): CardTransition {
	if (before?.zone === "receipt" && after.zone === "hand") {
		return { kind: "receipt-transfer" }
	}
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
	if (before.zone === "hand" && after.zone === "trick") {
		return { kind: "local-play" }
	}
	if (before.zone === "trick" && after.zone === "trick") {
		return { kind: "none" }
	}
	const moved =
		Math.hypot(before.left - after.left, before.top - after.top) > 0.5 ||
		Math.abs(before.width / Math.max(after.width, 1) - 1) > 0.01 ||
		Math.abs(before.height / Math.max(after.height, 1) - 1) > 0.01
	return { kind: moved ? "move" : "none" }
}

function takeSnapshots(
	root: HTMLElement,
	committed: ReadonlyMap<string, CardSnapshot> = new Map(),
	pending: ReadonlyMap<string, CardSnapshot> = new Map(),
): Map<string, CardSnapshot> {
	const snapshots = new Map<string, CardSnapshot>()
	for (const element of root.querySelectorAll<HTMLElement>(cardSelector)) {
		const cardId = element.dataset.cardId
		if (cardId === undefined) continue
		const pendingSnapshot = pending.get(cardId)
		const committedSnapshot =
			pendingSnapshot !== undefined &&
			(root.dataset.cardGesture === "pending" ||
				pendingSnapshot.zone === "receipt")
				? pendingSnapshot
				: committed.get(cardId)
		if (
			committedSnapshot !== undefined &&
			committedSnapshot.face === cardFace(element) &&
			committedSnapshot.dealRound === (element.dataset.dealRound ?? null) &&
			committedSnapshot.zone === cardMotionZone(element)
		) {
			snapshots.set(cardId, committedSnapshot)
			continue
		}
		snapshots.set(cardId, snapshotCard(element))
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

function animateLocalPlay(
	element: HTMLElement,
	before: CardSnapshot,
	after: CardSnapshot,
): Animation {
	const deltaX = before.left - after.left
	const deltaY = before.top - after.top
	const scaleX = before.width / Math.max(after.width, 1)
	const scaleY = before.height / Math.max(after.height, 1)
	const rotation = before.rotation - after.rotation
	return element.animate(
		[
			{
				transform: `translate3d(${deltaX}px, ${deltaY}px, 0) rotate(${rotation}deg) scale(${scaleX}, ${scaleY})`,
				transformOrigin: "top left",
			},
			{
				transform: settledTransform(element),
				transformOrigin: "top left",
			},
		],
		{
			duration: 360,
			easing: "cubic-bezier(.2,.75,.25,1)",
			fill: "backwards",
		},
	)
}

function animateReceiptTransfer(
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
				filter: "drop-shadow(0 0.9rem 1rem rgb(0 0 0 / 0.34))",
				transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})`,
			},
			{
				filter: "drop-shadow(0 0.55rem 0.7rem rgb(0 0 0 / 0.24))",
				offset: 0.78,
				transform: "translate3d(0, -8px, 0) scale(1.035)",
			},
			{
				filter: "drop-shadow(0 0 0 transparent)",
				transform: settledTransform(element),
			},
		],
		{
			duration: 480,
			easing: "cubic-bezier(.18,.78,.22,1)",
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
	const flyingBack = document.createElement("flight-back")
	flight.setAttribute("aria-hidden", "true")
	flight.dataset.motionKind = "opponent-play"
	flight.dataset.motionCardId = element.dataset.cardId
	root.dataset.lastCardMotionFace = "authoritative"
	flight.style.left = `${before.left}px`
	flight.style.top = `${before.top}px`
	flight.style.width = `${before.width}px`
	flight.style.height = `${before.height}px`
	flight.append(flyingBack)
	root.append(flight)

	element.style.opacity = "0"
	const deltaX = after.left - before.left
	const deltaY = after.top - before.top
	const scaleX = after.width / Math.max(before.width, 1)
	const scaleY = after.height / Math.max(before.height, 1)
	const flightAnimation = flight.animate(
		[
			{
				transform: `translate3d(0, 0, 0) scale(1) rotate(${before.rotation}deg)`,
			},
			{
				offset: 0.68,
				transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY}) rotate(${after.rotation}deg)`,
			},
			{
				transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY}) rotate(${after.rotation}deg)`,
			},
		],
		{
			duration: opponentPlayDurationMilliseconds,
			easing: "cubic-bezier(.2,.72,.2,1)",
		},
	)
	const faceAnimation = element.animate(
		[
			{ opacity: 0, transform: "rotateY(88deg)" },
			{ opacity: 0, offset: 0.68, transform: "rotateY(88deg)" },
			{ opacity: 1, transform: settledTransform(element) },
		],
		{
			duration: opponentPlayDurationMilliseconds,
			easing: "ease-in-out",
			fill: "both",
		},
	)
	const backAnimation = flyingBack.animate(
		[
			{ opacity: 1, transform: "rotateY(0deg)" },
			{ opacity: 1, offset: 0.68, transform: "rotateY(0deg)" },
			{ opacity: 0, transform: "rotateY(-88deg)" },
		],
		{
			duration: opponentPlayDurationMilliseconds,
			easing: "ease-in-out",
			fill: "both",
		},
	)
	const finishFlight = (): void => {
		faceAnimation.cancel()
		element.style.opacity = ""
		flight.remove()
	}
	void Promise.allSettled([
		flightAnimation.finished,
		faceAnimation.finished,
		backAnimation.finished,
	]).then(finishFlight)
	return flightAnimation
}

function animateCardChanges(
	root: HTMLElement,
	previous: Map<string, CardSnapshot>,
	committed: Map<string, CardSnapshot>,
	pending: Map<string, CardSnapshot>,
): Map<string, CardSnapshot> {
	const current = takeSnapshots(root, committed, pending)
	if (
		(root.dataset.cardGesture !== undefined &&
			root.dataset.cardGesture !== "pending") ||
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
						trackCommittedMotion(
							cardId,
							after,
							animateDeal(element, after, deckRect, transition.delay),
							committed,
						),
					)
				}
				break
			case "local-play":
				if (before !== undefined) {
					root.dataset.lastCardMotion = "local-play"
					root.dataset.lastCardMotionId = cardId
					root.dataset.lastCardMotionFrom = `${before.left},${before.top}`
					root.dataset.lastCardMotionTo = `${after.left},${after.top}`
					root.dataset.lastLocalPlayMotionId = cardId
					root.dataset.lastLocalPlayMotionFrom = `${before.left},${before.top}`
					root.dataset.lastLocalPlayMotionTo = `${after.left},${after.top}`
					root.dataset.lastLocalPlayMotionSize = `${before.width}x${before.height}->${after.width}x${after.height}`
					const animation = trackCommittedMotion(
						cardId,
						after,
						animateLocalPlay(element, before, after),
						committed,
					)
					void animation.finished.then(
						() => announceMotionComplete(root, cardId),
						() => announceMotionComplete(root, cardId),
					)
				}
				break
			case "move":
				if (before !== undefined) {
					root.dataset.lastCardMotion = "move"
					root.dataset.lastCardMotionId = cardId
					root.dataset.lastCardMotionFrom = `${before.left},${before.top}`
					root.dataset.lastCardMotionTo = `${after.left},${after.top}`
					const animation = trackCommittedMotion(
						cardId,
						after,
						animateMove(element, before, after),
						committed,
					)
					void animation.finished.then(
						() => announceMotionComplete(root, cardId),
						() => announceMotionComplete(root, cardId),
					)
				}
				break
			case "opponent-play":
				if (before !== undefined) {
					root.dataset.lastCardMotion = "opponent-play"
					root.dataset.lastCardMotionId = cardId
					const animation = animateOpponentPlay(root, element, before, after)
					void animation.finished.then(
						() => announceMotionComplete(root, cardId),
						() => announceMotionComplete(root, cardId),
					)
				}
				break
			case "receipt-transfer":
				if (before !== undefined) {
					root.dataset.lastCardMotion = "receipt-transfer"
					root.dataset.lastCardMotionId = cardId
					root.dataset.lastCardMotionFrom = `${before.left},${before.top}`
					root.dataset.lastCardMotionTo = `${after.left},${after.top}`
					const animation = trackCommittedMotion(
						cardId,
						after,
						animateReceiptTransfer(element, before, after),
						committed,
					)
					void animation.finished.then(
						() => announceMotionComplete(root, cardId),
						() => announceMotionComplete(root, cardId),
					)
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

function trackCommittedMotion(
	cardId: string,
	snapshot: CardSnapshot,
	animation: Animation,
	committed: Map<string, CardSnapshot>,
): Animation {
	committed.set(cardId, snapshot)
	const release = (): void => {
		if (committed.get(cardId) === snapshot) committed.delete(cardId)
	}
	void animation.finished.then(release, release)
	return animation
}

function isMotionOverlayMutation(record: MutationRecord): boolean {
	if (record.type !== "childList") return false
	if (
		record.target instanceof Element &&
		record.target.closest("card-flight") !== null
	) {
		return true
	}
	const changedNodes = [...record.addedNodes, ...record.removedNodes]
	return (
		changedNodes.length > 0 &&
		changedNodes.every(
			(node) => node instanceof Element && node.matches("card-flight"),
		)
	)
}

export function observeCardMotion(root: HTMLElement): () => void {
	root.dataset.motionReadyRound = root.dataset.cardRound ?? ""
	let snapshots = takeSnapshots(root)
	const committed = new Map<string, CardSnapshot>()
	const pending = new Map<string, CardSnapshot>()
	const animateMutation = (records: MutationRecord[]): void => {
		if (records.length > 0 && records.every(isMotionOverlayMutation)) return
		snapshots = animateCardChanges(root, snapshots, committed, pending)
		for (const [cardId, pendingSnapshot] of pending) {
			if (
				(pendingSnapshot.zone !== "receipt" &&
					root.dataset.cardGesture !== "pending") ||
				snapshots.get(cardId)?.zone !== pendingSnapshot.zone
			) {
				pending.delete(cardId)
			}
		}
	}
	const observer = new MutationObserver(animateMutation)
	const capturePendingCard = (event: Event): void => {
		const cardId = (event as CustomEvent<string>).detail
		const pendingElement = Array.from(
			root.querySelectorAll<HTMLElement>(cardSelector),
		).find((element) => element.dataset.cardId === cardId)
		if (pendingElement !== undefined) {
			const snapshot = snapshotCard(pendingElement, true)
			snapshots.set(cardId, snapshot)
			pending.set(cardId, snapshot)
			root.dataset.lastPendingCardMotionId = cardId
			root.dataset.lastPendingCardMotionPosition = `${snapshot.left},${snapshot.top}`
			root.dataset.lastPendingCardMotionSize = `${snapshot.width}x${snapshot.height}`
			root.dataset.lastPendingCardMotionRotation = String(snapshot.rotation)
		}
	}
	root.addEventListener(capturePendingCardEvent, capturePendingCard)
	observer.observe(root, {
		attributeFilter: ["data-card-round"],
		attributes: true,
		childList: true,
		subtree: true,
	})
	return () => {
		observer.disconnect()
		root.removeEventListener(capturePendingCardEvent, capturePendingCard)
	}
}

export function useCardMotion(root: HTMLElement | null): void {
	useEffect(() => (root === null ? undefined : observeCardMotion(root)), [root])
}
