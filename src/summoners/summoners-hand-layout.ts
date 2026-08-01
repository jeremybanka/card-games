export type SummonersHandCardLayout = {
	angle: number
	left: number
	rise: number
}

export function summonersHandCardLayout(
	cardCount: number,
	cardIndex: number,
): SummonersHandCardLayout {
	if (cardCount <= 1) {
		return { angle: 0, left: 50, rise: 0 }
	}
	const middle = (cardCount - 1) / 2
	const distanceFromMiddle = cardIndex - middle
	const spread = Math.min(84, (cardCount - 1) * 14)
	return {
		angle: distanceFromMiddle * Math.min(3.2, 31 / Math.max(cardCount, 1)),
		left: 50 + (distanceFromMiddle / middle) * (spread / 2),
		rise: Math.abs(distanceFromMiddle) * 0.7,
	}
}
