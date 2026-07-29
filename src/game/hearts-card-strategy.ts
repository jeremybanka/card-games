import type { VisibleCard } from "./game-types.ts"

export function heartsPointRisk(card: VisibleCard): number {
	if (card.suit === "spades" && card.rank === 12) return 100
	if (card.suit === "hearts") return 40 + card.rank
	if (card.suit === "spades" && card.rank > 12) return 25 + card.rank
	return card.rank
}
