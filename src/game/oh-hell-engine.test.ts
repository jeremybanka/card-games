import { describe, expect, it } from "vitest"

import { createSeededRandom } from "./seeded-random.ts"
import {
	createOhHellGame,
	configureOhHellRules,
	dealOhHellRound,
	joinOhHellGame,
	legalBidsFor,
	playableOhHellCardIdsFor,
	playOhHellCard,
	startNextOhHellRound,
	submitOhHellBid,
	toOhHellPrivatePlayerView,
	toOhHellPublicGameView,
} from "./oh-hell-engine.ts"
import type { CardId, PlayerId } from "./game-types.ts"
import type { OhHellRules } from "./oh-hell-rules.ts"

const ADA = "user::ada" satisfies PlayerId
const BEA = "user::bea" satisfies PlayerId
const CAL = "user::cal" satisfies PlayerId
const TEST_RULES = {
	awardPittancePoints: true,
	requireTrumpBreak: true,
	requireUnsatisfiableBids: true,
	schedule: {
		maximumHandSize: 5,
		minimumHandSize: 1,
		style: "descending",
	},
} as const satisfies OhHellRules
const TEST_HAND_SCHEDULE = [5, 4, 3, 2, 1]

function table(rules: OhHellRules = TEST_RULES) {
	let state = createOhHellGame("WIND", ADA, "Ada")
	state = configureOhHellRules(state, ADA, rules)
	state = joinOhHellGame(state, BEA, "Bea")
	return joinOhHellGame(state, CAL, "Cal")
}

function bidRound(state: ReturnType<typeof table>) {
	while (state.phase === "bidding") {
		const playerId = state.currentPlayerId as PlayerId
		const legal = legalBidsFor(state, playerId)
		state = submitOhHellBid(
			state,
			playerId,
			legal.includes(1) ? 1 : (legal[0] as number),
		)
	}
	return state
}

describe("Oh Hell engine", () => {
	it("starts with the standard Pagat rules and valley schedule", () => {
		let state = createOhHellGame("WIND", ADA, "Ada")
		state = joinOhHellGame(state, BEA, "Bea")
		state = joinOhHellGame(state, CAL, "Cal")
		state = dealOhHellRound(state, createSeededRandom("pagat-default").next)
		expect(state.rules).toMatchObject({
			awardPittancePoints: false,
			requireTrumpBreak: false,
			requireUnsatisfiableBids: true,
		})
		expect(state.roundHandSize).toBe(10)
		expect(state.roundHandSchedule).toEqual([
			10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
		])
	})

	it("supports up to twelve players and applies deck-safe limits", () => {
		let state = createOhHellGame("WIND", ADA, "Ada")
		for (let seat = 2; seat <= 12; seat += 1) {
			state = joinOhHellGame(
				state,
				`user::seat-${seat}` as PlayerId,
				`Seat ${seat}`,
			)
		}
		expect(state.players).toHaveLength(12)
		expect(() => joinOhHellGame(state, "user::seat-13", "Seat 13")).toThrow(
			"12 players",
		)
		expect(() =>
			dealOhHellRound({
				...state,
				rules: {
					...TEST_RULES,
					schedule: { handSize: 5, roundCount: 1, style: "flat" },
				},
			}),
		).toThrow("at most 4 cards")
	})

	it("allows only the host to configure rules before play", () => {
		const state = table()
		expect(() => configureOhHellRules(state, BEA, TEST_RULES)).toThrow(
			"Only the host",
		)
		const started = dealOhHellRound(state)
		expect(() => configureOhHellRules(started, ADA, TEST_RULES)).toThrow(
			"after the game starts",
		)
	})

	it("enforces ordered hook bidding and follow suit", () => {
		let state = dealOhHellRound(
			table(),
			createSeededRandom("oh-hell-rules").next,
		)
		expect(state.roundHandSize).toBe(5)
		expect(() => submitOhHellBid(state, ADA, 1)).toThrow("turn to bid")
		while (
			state.phase === "bidding" &&
			state.currentPlayerId !== state.dealerId
		) {
			state = submitOhHellBid(state, state.currentPlayerId as PlayerId, 1)
		}
		const dealer = state.currentPlayerId as PlayerId
		const existing = state.players.reduce(
			(sum, player) => sum + (player.bid ?? 0),
			0,
		)
		expect(legalBidsFor(state, dealer)).not.toContain(
			state.roundHandSize - existing,
		)
		state = submitOhHellBid(
			state,
			dealer,
			legalBidsFor(state, dealer)[0] as number,
		)

		const leader = state.currentPlayerId as PlayerId
		const leadCard = state.players.find((player) => player.id === leader)
			?.hand[0]
		state = playOhHellCard(state, leader, leadCard as `card::${string}`)
		const follower = state.players.find(
			(player) => player.id === state.currentPlayerId,
		)
		const leadSuit = state.cardValues[leadCard as `card::${string}`]?.suit
		const suited =
			follower?.hand.filter((id) => state.cardValues[id]?.suit === leadSuit) ??
			[]
		const offSuit = follower?.hand.find(
			(id) => state.cardValues[id]?.suit !== leadSuit,
		)
		if (suited.length > 0 && offSuit !== undefined) {
			expect(() =>
				playOhHellCard(state, follower?.id as PlayerId, offSuit),
			).toThrow("follow suit")
		}
	})

	it("requires trump to be broken before it is led unless only trump remains", () => {
		let state = dealOhHellRound(
			table(),
			createSeededRandom("oh-hell-unbroken-trump").next,
		)
		state = bidRound(state)
		const leaderId = state.currentPlayerId as PlayerId
		const leader = state.players.find((player) => player.id === leaderId)
		const trumpSuit = state.trumpSuit
		if (leader === undefined || trumpSuit === null) {
			throw new Error("The trump restriction fixture needs a leader and trump.")
		}
		const trumpCardId = leader.hand[0] as CardId
		const nonTrumpCardId = leader.hand[1] as CardId
		state.cardValues[trumpCardId] = { rank: 14, suit: trumpSuit }
		state.cardValues[nonTrumpCardId] = {
			rank: 2,
			suit: trumpSuit === "clubs" ? "diamonds" : "clubs",
		}

		expect(playableOhHellCardIdsFor(state, leaderId)).not.toContain(trumpCardId)
		expect(() => playOhHellCard(state, leaderId, trumpCardId)).toThrow(
			"cannot lead trump",
		)

		for (const cardId of leader.hand) {
			const card = state.cardValues[cardId]
			if (card === undefined) throw new Error("The dealt card needs a value.")
			state.cardValues[cardId] = {
				...card,
				suit: trumpSuit,
			}
		}
		expect(playableOhHellCardIdsFor(state, leaderId)).toEqual(leader.hand)
		expect(() => playOhHellCard(state, leaderId, trumpCardId)).not.toThrow()
	})

	it("allows a trick winner to lead trump after it has been broken", () => {
		let state = dealOhHellRound(
			table(),
			createSeededRandom("oh-hell-broken-trump").next,
		)
		state = bidRound(state)
		const leaderId = state.currentPlayerId as PlayerId
		const leader = state.players.find((player) => player.id === leaderId)
		const trumpSuit = state.trumpSuit
		const brokenTrumpCardId = state.trumpCardId
		if (
			leader === undefined ||
			trumpSuit === null ||
			brokenTrumpCardId === null
		) {
			throw new Error("The broken-trump fixture needs a leader and trump.")
		}
		const trumpCardId = leader.hand[0] as CardId
		const nonTrumpCardId = leader.hand[1] as CardId
		state.cardValues[trumpCardId] = {
			rank: 14,
			suit: trumpSuit,
		}
		state.cardValues[nonTrumpCardId] = {
			rank: 2,
			suit: state.trumpSuit === "clubs" ? "diamonds" : "clubs",
		}
		state.completedTricks = [
			{
				leftoverAward: null,
				plays: [
					{
						cardId: brokenTrumpCardId,
						playerId: leaderId,
					},
				],
				winnerId: leaderId,
			},
		]
		state.trickNumber = 1

		expect(playableOhHellCardIdsFor(state, leaderId)).toContain(trumpCardId)
		expect(() => playOhHellCard(state, leaderId, trumpCardId)).not.toThrow()
	})

	it("allows trump to be led immediately when the table does not require a break", () => {
		let state = dealOhHellRound(
			table({ ...TEST_RULES, requireTrumpBreak: false }),
			createSeededRandom("oh-hell-free-trump").next,
		)
		state = bidRound(state)
		const leaderId = state.currentPlayerId as PlayerId
		const leader = state.players.find((player) => player.id === leaderId)
		const trumpSuit = state.trumpSuit
		if (leader === undefined || trumpSuit === null) throw new Error("No trump.")
		const trumpCardId = leader.hand[0] as CardId
		state.cardValues[trumpCardId] = { rank: 14, suit: trumpSuit }
		expect(playableOhHellCardIdsFor(state, leaderId)).toContain(trumpCardId)
	})

	it("makes the dealer's bid unrestricted when the hot-seat rule is off", () => {
		let state = dealOhHellRound(
			table({ ...TEST_RULES, requireUnsatisfiableBids: false }),
			createSeededRandom("oh-hell-no-hook").next,
		)
		while (state.currentPlayerId !== state.dealerId) {
			state = submitOhHellBid(state, state.currentPlayerId as PlayerId, 1)
		}
		const existing = state.players.reduce(
			(sum, player) => sum + (player.bid ?? 0),
			0,
		)
		expect(legalBidsFor(state, state.dealerId as PlayerId)).toContain(
			state.roundHandSize - existing,
		)
	})

	it("awards pittance points on a missed bid only when configured", () => {
		const playOneTrick = (awardPittancePoints: boolean) => {
			const rules = {
				...TEST_RULES,
				awardPittancePoints,
				requireUnsatisfiableBids: false,
				schedule: { handSize: 1, roundCount: 1, style: "flat" as const },
			}
			let state = dealOhHellRound(
				table(rules),
				createSeededRandom("oh-hell-pittance").next,
			)
			while (state.phase === "bidding") {
				state = submitOhHellBid(state, state.currentPlayerId as PlayerId, 0)
			}
			while (state.phase === "playing") {
				const playerId = state.currentPlayerId as PlayerId
				const cardId = playableOhHellCardIdsFor(state, playerId)[0] as CardId
				state = playOhHellCard(state, playerId, cardId)
			}
			return state.players.find((player) => player.tricksWon === 1)?.roundPoints
		}
		expect(playOneTrick(false)).toBe(0)
		expect(playOneTrick(true)).toBe(1)
	})

	it("keeps hidden values private and remaps stable physical IDs each deal", () => {
		const random = createSeededRandom("oh-hell-privacy")
		let state = dealOhHellRound(table(), random.next)
		const physicalIds = [...state.physicalCardIds]
		const firstMapping = structuredClone(state.cardValues)
		const publicView = toOhHellPublicGameView(state)
		expect(publicView.gameKind).toBe("ohHell")
		expect("heartsBroken" in publicView).toBe(false)
		expect("passDirection" in publicView).toBe(false)
		expect(JSON.stringify(publicView)).not.toContain('"rank"')
		const privateView = toOhHellPrivatePlayerView(state, ADA)
		expect(privateView.gameKind).toBe("ohHell")
		expect("passReceipt" in privateView).toBe(false)
		expect(privateView.cards).toHaveLength(5)
		expect(privateView.cards.every((card) => card.rank >= 2)).toBe(true)

		state.phase = "roundComplete"
		state = startNextOhHellRound(state, ADA, random.next)
		expect(state.physicalCardIds).toEqual(physicalIds)
		expect(state.cardValues).not.toEqual(firstMapping)
	})

	it("projects a live trick counter after each completed trick", () => {
		let state = dealOhHellRound(
			table(),
			createSeededRandom("oh-hell-live-tricks").next,
		)
		state = bidRound(state)
		while (state.phase === "playing" && state.completedTricks.length === 0) {
			const id = state.currentPlayerId as PlayerId
			const cardId = toOhHellPrivatePlayerView(state, id).playableCardIds?.[0]
			state = playOhHellCard(state, id, cardId as `card::${string}`)
		}
		const publicView = toOhHellPublicGameView(state)
		const winner = publicView.players.find(
			(player) => player.id === state.lastTrickWinnerId,
		)
		expect(publicView.completedTricks).toHaveLength(1)
		expect(winner?.tricksWon).toBe(1)
		expect(
			publicView.players.reduce(
				(total, player) => total + (player.tricksWon ?? 0),
				0,
			),
		).toBe(1)
	})

	it("plays the complete deterministic five-round game and declares high-score winners", () => {
		let state = table()
		const random = createSeededRandom("oh-hell-complete-game")
		for (const expectedHandSize of TEST_HAND_SCHEDULE) {
			state =
				state.roundNumber === 0
					? dealOhHellRound(state, random.next)
					: startNextOhHellRound(state, ADA, random.next)
			expect(state.roundHandSize).toBe(expectedHandSize)
			state = bidRound(state)
			while (state.phase === "playing") {
				const id = state.currentPlayerId as PlayerId
				const cardId = toOhHellPrivatePlayerView(state, id).playableCardIds?.[0]
				state = playOhHellCard(state, id, cardId as `card::${string}`)
			}
		}
		expect(state.phase).toBe("gameComplete")
		expect(state.winnerIds.length).toBeGreaterThan(0)
		expect(state.players.every((player) => player.score >= 0)).toBe(true)
	})
})
