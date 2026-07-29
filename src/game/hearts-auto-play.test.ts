import { describe, expect, it } from "vitest"

import {
	autoPlayTurnFingerprint,
	chooseHeartsAutoPlayCard,
	isAutoPlayTurnActionable,
} from "./hearts-auto-play.ts"
import {
	EMPTY_HEARTS_PRIVATE_PLAYER_VIEW,
	EMPTY_HEARTS_PUBLIC_GAME_VIEW,
	type CardId,
	type PlayerId,
	type PrivatePlayerView,
	type PublicGameView,
	type Rank,
	type Suit,
	type VisibleCard,
} from "./game-types.ts"

const me = "user::me" as PlayerId
const other = "user::other" as PlayerId

function card(suit: Suit, rank: Rank, suffix = ""): VisibleCard {
	return {
		id: `card::${suit}-${rank}${suffix}` as CardId,
		rank,
		suit,
	}
}

describe("chooseHeartsAutoPlayCard", () => {
	it("leads the lowest-risk legal card and ignores non-playable hand cards", () => {
		const twoClubs = card("clubs", 2)
		const twoDiamonds = card("diamonds", 2)
		const queenSpades = card("spades", 12)
		expect(
			chooseHeartsAutoPlayCard(
				[twoDiamonds, queenSpades, twoClubs],
				[twoDiamonds.id, queenSpades.id],
				[],
			),
		).toBe(twoDiamonds.id)
	})

	it("breaks equal-risk lead ties independently of private hand order", () => {
		const twoClubs = card("clubs", 2)
		const twoDiamonds = card("diamonds", 2)
		const playable = [twoDiamonds.id, twoClubs.id]
		expect(
			chooseHeartsAutoPlayCard([twoDiamonds, twoClubs], playable, []),
		).toBe(twoClubs.id)
		expect(
			chooseHeartsAutoPlayCard([twoClubs, twoDiamonds], playable, []),
		).toBe(twoClubs.id)
	})

	it("follows suit with the highest card that remains below the winner", () => {
		const five = card("clubs", 5)
		const nine = card("clubs", 9)
		const king = card("clubs", 13)
		expect(
			chooseHeartsAutoPlayCard(
				[five, nine, king],
				[five.id, nine.id, king.id],
				[{ card: card("clubs", 10), playerId: other }],
			),
		).toBe(nine.id)
	})

	it("plays the lowest legal follower when every card would win", () => {
		const five = card("clubs", 5)
		const king = card("clubs", 13)
		expect(
			chooseHeartsAutoPlayCard(
				[king, five],
				[king.id, five.id],
				[{ card: card("clubs", 3), playerId: other }],
			),
		).toBe(five.id)
	})

	it("discards the queen of spades, then high hearts, then high cards", () => {
		const queenSpades = card("spades", 12)
		const aceHearts = card("hearts", 14)
		const aceClubs = card("clubs", 14)
		const trick = [{ card: card("diamonds", 7), playerId: other }]
		expect(
			chooseHeartsAutoPlayCard(
				[aceClubs, aceHearts, queenSpades],
				[aceClubs.id, aceHearts.id, queenSpades.id],
				trick,
			),
		).toBe(queenSpades.id)
		expect(
			chooseHeartsAutoPlayCard(
				[aceClubs, aceHearts],
				[aceClubs.id, aceHearts.id],
				trick,
			),
		).toBe(aceHearts.id)
		expect(
			chooseHeartsAutoPlayCard(
				[card("clubs", 2), aceClubs],
				[card("clubs", 2).id, aceClubs.id],
				trick,
			),
		).toBe(aceClubs.id)
	})

	it("returns the sole server-projected legal card", () => {
		const two = card("clubs", 2)
		const ace = card("hearts", 14)
		expect(chooseHeartsAutoPlayCard([ace, two], [two.id], [])).toBe(two.id)
	})

	it("fails rather than inventing a move when no legal ID resolves", () => {
		expect(() =>
			chooseHeartsAutoPlayCard(
				[card("clubs", 2)],
				["card::stale" as CardId],
				[],
			),
		).toThrow("There is no legal card")
	})
})

describe("auto-play turn identity and readiness", () => {
	const two = card("clubs", 2)
	const game: PublicGameView = {
		...EMPTY_HEARTS_PUBLIC_GAME_VIEW,
		currentPlayerId: me,
		gameKind: "hearts",
		phase: "playing",
		roomCode: "WIND",
		roundNumber: 2,
		trickNumber: 7,
	}
	const privateView: PrivatePlayerView = {
		...EMPTY_HEARTS_PRIVATE_PLAYER_VIEW,
		cards: [two],
		playableCardIds: [two.id],
		playerId: me,
	}

	it("requires the authoritative local turn and presentation readiness", () => {
		expect(isAutoPlayTurnActionable(game, privateView, me, true)).toBe(true)
		expect(isAutoPlayTurnActionable(game, privateView, me, false)).toBe(false)
		expect(
			isAutoPlayTurnActionable(
				{ ...game, currentPlayerId: other },
				privateView,
				me,
				true,
			),
		).toBe(false)
		expect(
			isAutoPlayTurnActionable(
				{ ...game, phase: "passing" },
				privateView,
				me,
				true,
			),
		).toBe(false)
		expect(
			isAutoPlayTurnActionable(
				{
					bidPlayerId: null,
					bidsSubmitted: 0,
					completedTricks: [],
					currentPlayerId: me,
					currentTrick: [],
					dealerId: other,
					deckCardIds: [],
					gameKind: "ohHell",
					hostId: me,
					lastTrickWinnerId: null,
					maximumRounds: 5,
					phase: "playing",
					players: [],
					roomCode: "WIND",
					roundHandSize: 2,
					roundNumber: 2,
					statusMessage: "Your play.",
					trickLeaderId: me,
					trickNumber: 0,
					trumpSuit: "clubs",
					winnerIds: [],
				},
				privateView,
				me,
				true,
			),
		).toBe(false)
	})

	it("fingerprints repeated projections and changes with actionable state", () => {
		const fingerprint = autoPlayTurnFingerprint(game, privateView, me)
		expect(
			autoPlayTurnFingerprint(
				{ ...game, players: [...game.players] },
				{ ...privateView, cards: [...privateView.cards] },
				me,
			),
		).toBe(fingerprint)
		expect(
			autoPlayTurnFingerprint(
				{ ...game, trickNumber: game.trickNumber + 1 },
				privateView,
				me,
			),
		).not.toBe(fingerprint)
		expect(
			autoPlayTurnFingerprint(
				game,
				{ ...privateView, cards: [card("hearts", 14)] },
				me,
			),
		).not.toBe(fingerprint)
	})
})
