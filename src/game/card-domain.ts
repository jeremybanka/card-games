import type {
	CardId,
	CardValue,
	Rank,
	Suit,
	VisibleCard,
} from "./game-types.ts"

type CardValueState = {
	cardValues: Partial<Record<CardId, CardValue>>
}

const suitOrder: Record<Suit, number> = {
	clubs: 0,
	diamonds: 1,
	spades: 2,
	hearts: 3,
}

export function secureRandom(): number {
	const value = crypto.getRandomValues(new Uint32Array(1))[0] as number
	return value / 4_294_967_296
}

export function shuffled<T>(input: readonly T[], random: () => number): T[] {
	const output = [...input]
	for (let index = output.length - 1; index > 0; index -= 1) {
		const swapIndex = Math.floor(random() * (index + 1))
		const value = output[index]
		output[index] = output[swapIndex] as T
		output[swapIndex] = value as T
	}
	return output
}

export function createPhysicalCardIds(
	createId: () => string = () => crypto.randomUUID(),
): CardId[] {
	return Array.from(
		{ length: 52 },
		() => `card::${createId()}` satisfies CardId,
	)
}

export function createDeck(): CardValue[] {
	const suits: Suit[] = ["clubs", "diamonds", "spades", "hearts"]
	const deck: CardValue[] = []
	for (const suit of suits) {
		for (let rank = 2; rank <= 14; rank += 1) {
			deck.push({ rank: rank as Rank, suit })
		}
	}
	return deck
}

export function cardValue(
	state: CardValueState,
	cardId: CardId,
	inactiveCardError: () => Error,
): CardValue {
	const value = state.cardValues[cardId]
	if (value === undefined) throw inactiveCardError()
	return value
}

export function visibleCard(
	state: CardValueState,
	cardId: CardId,
	inactiveCardError: () => Error,
): VisibleCard {
	return { id: cardId, ...cardValue(state, cardId, inactiveCardError) }
}

export function sortedHand(
	state: CardValueState,
	hand: readonly CardId[],
	inactiveCardError: () => Error,
): CardId[] {
	return [...hand].sort((leftId, rightId) => {
		const left = cardValue(state, leftId, inactiveCardError)
		const right = cardValue(state, rightId, inactiveCardError)
		return (
			suitOrder[left.suit] - suitOrder[right.suit] || left.rank - right.rank
		)
	})
}
