export type HandCardLayout = {
	angle: number
	left: number
	rise: number
}

export type CardGesture<CardId extends string = string> = {
	cardId: CardId
	phase: "dragging" | "picking"
}

export type DragTranslation = {
	x: number
	y: number
}

export const HAND_SCRUBBING_BAND_TOP = -28
export const DRAGGED_CARD_SCALE = 1.06

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

export function cardGesturePhase(
	verticalDistance: number,
): "dragging" | "picking" {
	return verticalDistance < HAND_SCRUBBING_BAND_TOP ? "dragging" : "picking"
}

export function advanceCardGesture<CardId extends string>(
	gesture: CardGesture<CardId>,
	scrubbedCardId: CardId,
	verticalDistance: number,
): CardGesture<CardId> {
	if (gesture.phase === "dragging") {
		return gesture
	}
	const phase = cardGesturePhase(verticalDistance)
	return {
		cardId: phase === "dragging" ? gesture.cardId : scrubbedCardId,
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
