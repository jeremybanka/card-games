import { describe, expect, it } from "vitest"

import { createSeededRandom } from "./seeded-random.ts"
import {
	createOhHellGame,
	dealOhHellRound,
	joinOhHellGame,
	legalBidsFor,
	OH_HELL_HAND_SCHEDULE,
	playOhHellCard,
	startNextOhHellRound,
	submitOhHellBid,
	toOhHellPrivatePlayerView,
	toOhHellPublicGameView,
} from "./oh-hell-engine.ts"
import type { PlayerId } from "./game-types.ts"

const ADA = "user::ada" satisfies PlayerId
const BEA = "user::bea" satisfies PlayerId
const CAL = "user::cal" satisfies PlayerId

function table() {
	let state = createOhHellGame("WIND", ADA, "Ada")
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
		for (const expectedHandSize of OH_HELL_HAND_SCHEDULE) {
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
