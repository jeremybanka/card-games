import type { CardId, Rank, Suit, VisibleCard } from "../game/game-types.ts"
import type { AiCardValue } from "./ai-types.ts"

const rankCodes: Record<Rank, AiCardValue[0]> = {
	2: "2",
	3: "3",
	4: "4",
	5: "5",
	6: "6",
	7: "7",
	8: "8",
	9: "9",
	10: "T",
	11: "J",
	12: "Q",
	13: "K",
	14: "A",
}

const suitCodes: Record<Suit, AiCardValue[1]> = {
	clubs: "C",
	diamonds: "D",
	hearts: "H",
	spades: "S",
}

export function aiCardValue(
	card: Pick<VisibleCard, "rank" | "suit">,
): AiCardValue {
	return `${rankCodes[card.rank]}${suitCodes[card.suit]}` as AiCardValue
}

export function cardIdForAiValue(
	cards: readonly VisibleCard[],
	value: AiCardValue,
): CardId {
	const card = cards.find((candidate) => aiCardValue(candidate) === value)
	if (card === undefined) {
		throw new Error(
			`The AI selected ${value}, which is not in its private hand.`,
		)
	}
	return card.id
}
