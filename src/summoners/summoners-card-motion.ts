import { useEffect } from "preact/hooks"

import type { CardId } from "../game/game-types.ts"

type SummonersCardZone = "battlefield" | "equipped" | "hand" | "other"

type SummonersCardSnapshot = {
	element: HTMLElement
	height: number
	left: number
	top: number
	width: number
	zone: SummonersCardZone
}

const cardSelector =
	"summoners-card[data-card-id]:not([data-motion-flight]), equipped-item[data-card-id]"

function cardZone(element: HTMLElement): SummonersCardZone {
	if (element.matches("equipped-item")) return "equipped"
	if (element.closest("player-hand") !== null) return "hand"
	if (element.closest("player-battlefield, opponent-battlefield") !== null) {
		return "battlefield"
	}
	return "other"
}

function snapshotCard(element: HTMLElement): SummonersCardSnapshot {
	const rect = element.getBoundingClientRect()
	return {
		element,
		height: element.offsetHeight || rect.height,
		left: rect.left,
		top: rect.top,
		width: element.offsetWidth || rect.width,
		zone: cardZone(element),
	}
}

function takeSnapshots(root: HTMLElement): Map<string, SummonersCardSnapshot> {
	const snapshots = new Map<string, SummonersCardSnapshot>()
	for (const element of root.querySelectorAll<HTMLElement>(cardSelector)) {
		const cardId = element.dataset.cardId
		if (cardId !== undefined) snapshots.set(cardId, snapshotCard(element))
	}
	return snapshots
}

function animateFrom(
	element: HTMLElement,
	before: SummonersCardSnapshot,
	after: SummonersCardSnapshot,
	duration = 360,
): void {
	if (typeof element.animate !== "function") return
	const deltaX = before.left - after.left
	const deltaY = before.top - after.top
	const scaleX = before.width / Math.max(after.width, 1)
	const scaleY = before.height / Math.max(after.height, 1)
	element.animate(
		[
			{
				transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})`,
				transformOrigin: "top left",
			},
			{
				transform: "translate3d(0, 0, 0) scale(1)",
				transformOrigin: "top left",
			},
		],
		{
			duration,
			easing: "cubic-bezier(.2,.75,.25,1)",
		},
	)
}

function animateDeal(
	root: HTMLElement,
	element: HTMLElement,
	after: SummonersCardSnapshot,
): void {
	const origin = root.querySelector<HTMLElement>(
		"[data-summoners-card-motion-origin='deck']",
	)
	if (origin === null) return
	const rect = origin.getBoundingClientRect()
	animateFrom(
		element,
		{
			element,
			height: rect.height,
			left: rect.left,
			top: rect.top,
			width: rect.width,
			zone: "other",
		},
		after,
		420,
	)
}

function animateVanishingCard(
	root: HTMLElement,
	snapshot: SummonersCardSnapshot,
): void {
	const destination = root.querySelector<HTMLElement>("action-channel")
	if (destination === null || typeof snapshot.element.animate !== "function") {
		return
	}
	const destinationRect = destination.getBoundingClientRect()
	const flight = snapshot.element.cloneNode(true) as HTMLElement
	flight.dataset.motionFlight = ""
	flight.setAttribute("aria-hidden", "true")
	flight.style.position = "fixed"
	flight.style.zIndex = "70"
	flight.style.left = `${snapshot.left}px`
	flight.style.top = `${snapshot.top}px`
	flight.style.width = `${snapshot.width}px`
	flight.style.height = `${snapshot.height}px`
	flight.style.pointerEvents = "none"
	root.append(flight)
	const deltaX =
		destinationRect.left +
		destinationRect.width / 2 -
		(snapshot.left + snapshot.width / 2)
	const deltaY =
		destinationRect.top +
		destinationRect.height / 2 -
		(snapshot.top + snapshot.height / 2)
	const animation = flight.animate(
		[
			{ filter: "brightness(1)", opacity: 1, transform: "scale(1)" },
			{
				filter: "brightness(1.35)",
				opacity: 0,
				transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(.28) rotate(8deg)`,
			},
		],
		{
			duration: 440,
			easing: "cubic-bezier(.2,.72,.2,1)",
		},
	)
	void animation.finished.then(
		() => flight.remove(),
		() => flight.remove(),
	)
}

function isFlightMutation(record: MutationRecord): boolean {
	if (record.type !== "childList") return false
	const changed = [...record.addedNodes, ...record.removedNodes]
	return (
		changed.length > 0 &&
		changed.every(
			(node) => node instanceof Element && node.matches("[data-motion-flight]"),
		)
	)
}

export function capturePendingSummonersCardMotion(
	root: HTMLElement,
	cardId: CardId,
): void {
	root.dispatchEvent(
		new CustomEvent<CardId>("summoners:capture-pending-card", {
			detail: cardId,
		}),
	)
}

export function observeSummonersCardMotion(root: HTMLElement): () => void {
	let snapshots = takeSnapshots(root)
	const pending = new Map<string, SummonersCardSnapshot>()
	const animateMutation = (records: MutationRecord[]): void => {
		if (records.length > 0 && records.every(isFlightMutation)) return
		const current = takeSnapshots(root)
		if (
			typeof matchMedia === "function" &&
			matchMedia("(prefers-reduced-motion: reduce)").matches
		) {
			pending.clear()
			snapshots = current
			return
		}
		let reportedMotion: {
			cardId: string
			kind: "cast" | "deal" | "move" | "play"
		} | null = null
		for (const [cardId, after] of current) {
			const before = pending.get(cardId) ?? snapshots.get(cardId)
			if (before === undefined) {
				if (after.zone === "hand") {
					if (reportedMotion === null) {
						reportedMotion = { cardId, kind: "deal" }
					}
					animateDeal(root, after.element, after)
				}
				continue
			}
			const moved =
				Math.hypot(before.left - after.left, before.top - after.top) > 0.5 ||
				Math.abs(before.width / Math.max(after.width, 1) - 1) > 0.01 ||
				Math.abs(before.height / Math.max(after.height, 1) - 1) > 0.01
			if (!moved) continue
			const kind =
				before.zone === "hand" && after.zone !== "hand" ? "play" : "move"
			if (reportedMotion === null || kind === "play") {
				reportedMotion = { cardId, kind }
			}
			animateFrom(after.element, before, after)
		}
		for (const [cardId, before] of pending) {
			if (current.has(cardId)) continue
			reportedMotion = { cardId, kind: "cast" }
			animateVanishingCard(root, before)
		}
		if (reportedMotion !== null) {
			root.dataset.lastSummonersCardMotion = reportedMotion.kind
			root.dataset.lastSummonersCardMotionId = reportedMotion.cardId
		}
		pending.clear()
		snapshots = current
	}
	const observer = new MutationObserver(animateMutation)
	const capturePending = (event: Event): void => {
		const cardId = (event as CustomEvent<CardId>).detail
		const element = Array.from(
			root.querySelectorAll<HTMLElement>(cardSelector),
		).find((candidate) => candidate.dataset.cardId === cardId)
		if (element !== undefined) pending.set(cardId, snapshotCard(element))
	}
	root.addEventListener("summoners:capture-pending-card", capturePending)
	observer.observe(root, { childList: true, subtree: true })
	return () => {
		observer.disconnect()
		root.removeEventListener("summoners:capture-pending-card", capturePending)
	}
}

export function useSummonersCardMotion(root: HTMLElement | null): void {
	useEffect(
		() => (root === null ? undefined : observeSummonersCardMotion(root)),
		[root],
	)
}
