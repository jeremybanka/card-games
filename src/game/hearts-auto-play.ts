import type {
	CardId,
	GameKind,
	PlayerId,
	PrivatePlayerView,
	PublicGameView,
	Suit,
	TrickPlay,
	VisibleCard,
} from "./game-types.ts"

const SUIT_ORDER: Record<Suit, number> = {
	clubs: 0,
	diamonds: 1,
	spades: 2,
	hearts: 3,
}

function pointRisk(card: VisibleCard): number {
	if (card.suit === "spades" && card.rank === 12) return 100
	if (card.suit === "hearts") return 40 + card.rank
	if (card.suit === "spades" && card.rank > 12) return 25 + card.rank
	return card.rank
}

function deterministicCardOrder(left: VisibleCard, right: VisibleCard): number {
	return (
		left.rank - right.rank ||
		SUIT_ORDER[left.suit] - SUIT_ORDER[right.suit] ||
		left.id.localeCompare(right.id)
	)
}

function legalCards(
	cards: readonly VisibleCard[],
	playableCardIds: readonly CardId[],
): VisibleCard[] {
	const playable = new Set(playableCardIds)
	return cards.filter((card) => playable.has(card.id))
}

/**
 * Chooses one card from the server-projected legal IDs without applying rules
 * in the browser. Public trick values are used only to rank those candidates.
 */
export function chooseHeartsAutoPlayCard(
	cards: readonly VisibleCard[],
	playableCardIds: readonly CardId[],
	currentTrick: readonly TrickPlay[],
): CardId {
	const candidates = legalCards(cards, playableCardIds)
	if (candidates.length === 0) {
		throw new Error("There is no legal card to play.")
	}
	if (candidates.length === 1) return (candidates[0] as VisibleCard).id

	const leadPlay = currentTrick[0]
	if (leadPlay === undefined) {
		return (
			[...candidates].sort(
				(left, right) =>
					pointRisk(left) - pointRisk(right) ||
					deterministicCardOrder(left, right),
			)[0] as VisibleCard
		).id
	}

	const leadSuit = leadPlay.card.suit
	const followingSuit = candidates.filter((card) => card.suit === leadSuit)
	if (followingSuit.length > 0) {
		const currentWinningRank = Math.max(
			...currentTrick
				.filter((play) => play.card.suit === leadSuit)
				.map((play) => play.card.rank),
		)
		const safeCards = followingSuit
			.filter((card) => card.rank < currentWinningRank)
			.sort(
				(left, right) =>
					right.rank - left.rank || deterministicCardOrder(left, right),
			)
		return (
			safeCards[0] ??
			([...followingSuit].sort(deterministicCardOrder)[0] as VisibleCard)
		).id
	}

	return (
		[...candidates].sort(
			(left, right) =>
				pointRisk(right) - pointRisk(left) ||
				deterministicCardOrder(left, right),
		)[0] as VisibleCard
	).id
}

export function autoPlayTurnFingerprint(
	game: PublicGameView,
	privateView: PrivatePlayerView,
	playerId: PlayerId,
): string {
	return [
		game.roomCode,
		game.roundNumber,
		game.trickNumber,
		game.currentPlayerId,
		playerId,
		privateView.cards.map((card) => card.id).join(","),
		privateView.playableCardIds.join(","),
	].join("|")
}

export function isAutoPlayTurnActionable(
	game: PublicGameView,
	privateView: PrivatePlayerView,
	playerId: PlayerId,
	presentationReady: boolean,
): boolean {
	const readiness = autoPlayReadiness[game.gameKind]
	if (readiness === undefined || privateView.gameKind !== game.gameKind) {
		return false
	}
	return readiness(
		game as never,
		privateView as never,
		playerId,
		presentationReady,
	)
}

const autoPlayReadiness = {
	hearts: (
		game: Extract<PublicGameView, { gameKind: "hearts" }>,
		privateView: Extract<PrivatePlayerView, { gameKind: "hearts" }>,
		playerId: PlayerId,
		presentationReady: boolean,
	): boolean =>
		game.phase === "playing" &&
		game.currentPlayerId === playerId &&
		privateView.playerId === playerId &&
		privateView.playableCardIds.length > 0 &&
		presentationReady,
} as unknown as Partial<
	Record<
		GameKind,
		(
			game: PublicGameView,
			privateView: PrivatePlayerView,
			playerId: PlayerId,
			presentationReady: boolean,
		) => boolean
	>
>
