export type HandCardLayout = {
	angle: number
	left: number
	rise: number
}

export type CompactHandCardLayout = HandCardLayout

export type CardGesture<CardId extends string = string> = {
	cardId: CardId
	phase: "dragging" | "picking"
}

export type DragTranslation = {
	x: number
	y: number
}

export type CardDestination = "hand" | "pass"

export const HAND_SCRUBBING_BAND_TOP = -28
export const HAND_OUTWARD_INTENT_TOP = -8
export const HAND_OUTWARD_CORRIDOR_BASE = 18
export const HAND_OUTWARD_CORRIDOR_SLOPE = 0.8
export const DRAGGED_CARD_SCALE = 1.1
export const HOVER_VIEWPORT_GUTTER = 8

export function readableCardHorizontalCorrection(
	cardCenterX: number,
	cardWidth: number,
	viewportWidth: number,
	gutter = HOVER_VIEWPORT_GUTTER,
): number {
	const safeViewportWidth = Math.max(0, viewportWidth - gutter * 2)
	if (cardWidth >= safeViewportWidth) {
		return viewportWidth / 2 - cardCenterX
	}
	const minimumCenter = gutter + cardWidth / 2
	const maximumCenter = viewportWidth - gutter - cardWidth / 2
	const readableCenter = Math.max(
		minimumCenter,
		Math.min(cardCenterX, maximumCenter),
	)
	return readableCenter - cardCenterX
}

export function handCardLayout(
	cardCount: number,
	cardIndex: number,
): HandCardLayout {
	if (cardCount <= 1) {
		return { angle: 0, left: 50, rise: 0 }
	}
	const middle = (cardCount - 1) / 2
	const distanceFromMiddle = cardIndex - middle
	const spread = Math.min(84, (cardCount - 1) * 14)
	return {
		angle: distanceFromMiddle * Math.min(3.2, 31 / Math.max(cardCount, 1)),
		left: 50 + (distanceFromMiddle / middle) * (spread / 2),
		rise: Math.abs(distanceFromMiddle) * 1.2,
	}
}

export function compactHandCardLayout(
	cardCount: number,
	cardIndex: number,
): CompactHandCardLayout {
	const layout = handCardLayout(cardCount, cardIndex)
	return {
		angle: layout.angle * 0.5,
		left: layout.left,
		rise: layout.rise * 0.25,
	}
}

export function passSelectionAfterDrop<CardId extends string>(
	current: readonly CardId[],
	cardId: CardId,
	source: CardDestination,
	destination: CardDestination | null,
	destinationIndex = current.length,
): CardId[] {
	if (destination === null) return [...current]
	if (source === "hand") {
		if (
			destination !== "pass" ||
			current.includes(cardId) ||
			current.length >= 3
		) {
			return [...current]
		}
		const index = Math.max(0, Math.min(destinationIndex, current.length))
		return [...current.slice(0, index), cardId, ...current.slice(index)]
	}
	const withoutCard = current.filter((candidate) => candidate !== cardId)
	if (destination === "hand") return withoutCard
	const index = Math.max(0, Math.min(destinationIndex, withoutCard.length))
	return [...withoutCard.slice(0, index), cardId, ...withoutCard.slice(index)]
}

export function cardGesturePhase(
	verticalDistance: number,
): "dragging" | "picking" {
	return verticalDistance < HAND_SCRUBBING_BAND_TOP ? "dragging" : "picking"
}

export function advanceCardGesture<CardId extends string>(
	gesture: CardGesture<CardId>,
	scrubbedCardId: CardId,
	pointerDelta: DragTranslation,
): CardGesture<CardId> {
	if (gesture.phase === "dragging") {
		return gesture
	}
	const phase = cardGesturePhase(pointerDelta.y)
	const outwardCorridorHalfWidth =
		HAND_OUTWARD_CORRIDOR_BASE +
		Math.abs(pointerDelta.y) * HAND_OUTWARD_CORRIDOR_SLOPE
	const preservesOutwardIntent =
		pointerDelta.y < HAND_OUTWARD_INTENT_TOP &&
		Math.abs(pointerDelta.x) <= outwardCorridorHalfWidth
	return {
		cardId:
			phase === "dragging" || preservesOutwardIntent
				? gesture.cardId
				: scrubbedCardId,
		phase,
	}
}

export function dragTranslationFromPointer(
	angle: number,
	base: DragTranslation,
	pointerDelta: DragTranslation,
): DragTranslation {
	const radians = (-angle * Math.PI) / 180
	return {
		x:
			base.x +
			pointerDelta.x * Math.cos(radians) -
			pointerDelta.y * Math.sin(radians),
		y:
			base.y +
			pointerDelta.x * Math.sin(radians) +
			pointerDelta.y * Math.cos(radians),
	}
}

export function draggedCardTransform(
	angle: number,
	translation: DragTranslation,
): string {
	return `translate3d(${translation.x}px, ${translation.y}px, 0) rotate(${-angle}deg) scale(${DRAGGED_CARD_SCALE})`
}
