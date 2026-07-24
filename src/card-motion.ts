import type { RefObject } from "preact"
import { useEffect } from "preact/hooks"

type CardSnapshot = {
	face: "down" | "up"
	height: number
	left: number
	top: number
	width: number
}

const cardSelector = "playing-card[data-card-id], card-back[data-card-id]"

function cardFace(element: HTMLElement): CardSnapshot["face"] {
	return element.matches("playing-card") ? "up" : "down"
}

function takeSnapshots(root: HTMLElement): Map<string, CardSnapshot> {
	const snapshots = new Map<string, CardSnapshot>()
	for (const element of root.querySelectorAll<HTMLElement>(cardSelector)) {
		const cardId = element.dataset.cardId
		if (cardId === undefined) continue
		const rect = element.getBoundingClientRect()
		snapshots.set(cardId, {
			face: cardFace(element),
			height: rect.height,
			left: rect.left,
			top: rect.top,
			width: rect.width,
		})
	}
	return snapshots
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
		return current
	}

	let sequence = 0
	for (const element of root.querySelectorAll<HTMLElement>(cardSelector)) {
		if (typeof element.animate !== "function") continue
		const cardId = element.dataset.cardId
		if (cardId === undefined) continue
		const before = previous.get(cardId)
		const after = current.get(cardId)
		if (after === undefined) continue
		const targetTransform = getComputedStyle(element).transform
		const settledTransform =
			targetTransform === "none" ? "none" : targetTransform

		if (before === undefined) {
			element.animate(
				[
					{
						opacity: 0,
						transform: `rotateY(-88deg) scale(0.92)`,
					},
					{ opacity: 1, transform: settledTransform },
				],
				{
					delay: Math.min(sequence, 18) * 14,
					duration: 260,
					easing: "cubic-bezier(.2,.75,.25,1)",
				},
			)
			sequence += 1
			continue
		}

		const deltaX = before.left - after.left
		const deltaY = before.top - after.top
		const scaleX = after.width === 0 ? 1 : before.width / after.width
		const scaleY = after.height === 0 ? 1 : before.height / after.height
		const faceChanged = before.face !== after.face
		const positionChanged = Math.hypot(deltaX, deltaY) > 0.5
		const sizeChanged =
			Math.abs(scaleX - 1) > 0.01 || Math.abs(scaleY - 1) > 0.01
		if (!(faceChanged || positionChanged || sizeChanged)) continue

		const flip = faceChanged ? " rotateY(88deg)" : ""
		const target = targetTransform === "none" ? "" : ` ${targetTransform}`
		element.animate(
			[
				{
					opacity: faceChanged ? 0.35 : 1,
					transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})${flip}${target}`,
				},
				{ opacity: 1, transform: settledTransform },
			],
			{
				duration: faceChanged ? 420 : 320,
				easing: "cubic-bezier(.2,.75,.25,1)",
			},
		)
	}
	return current
}

export function useCardMotion(rootRef: RefObject<HTMLElement>): void {
	useEffect(() => {
		const root = rootRef.current
		if (root === null) return
		let snapshots = takeSnapshots(root)
		let animationFrame: number | null = null
		const scheduleAnimation = (): void => {
			if (animationFrame !== null) cancelAnimationFrame(animationFrame)
			animationFrame = requestAnimationFrame(() => {
				animationFrame = null
				snapshots = animateCardChanges(root, snapshots)
			})
		}
		const observer = new MutationObserver(scheduleAnimation)
		observer.observe(root, { childList: true, subtree: true })
		return () => {
			observer.disconnect()
			if (animationFrame !== null) cancelAnimationFrame(animationFrame)
		}
	}, [rootRef])
}
