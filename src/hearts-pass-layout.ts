export type HeartsPassDestination = "hand" | "pass"

export function heartsPassSelectionAfterDrop<CardId extends string>(
	current: readonly CardId[],
	cardId: CardId,
	source: HeartsPassDestination,
	destination: HeartsPassDestination | null,
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
