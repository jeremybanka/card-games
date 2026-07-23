import { describe, expect, it } from "vitest"

import {
	createHeartsGame,
	dealRound,
	joinHeartsGame,
	playableCardIdsFor,
	playCard,
	startGame,
	submitPass,
	toPrivatePlayerView,
	toPublicGameView,
	type HeartsState,
} from "./hearts-engine.ts"
import type { CardId, PlayerId } from "./hearts-types.ts"

const playerIds = [
	"user::00000000-0000-4000-8000-000000000001",
	"user::00000000-0000-4000-8000-000000000002",
	"user::00000000-0000-4000-8000-000000000003",
	"user::00000000-0000-4000-8000-000000000004",
] as const satisfies readonly PlayerId[]

function physicalIds(): CardId[] {
	return Array.from(
		{ length: 52 },
		(_, index) => `card::physical-${String(index).padStart(2, "0")}` as CardId,
	)
}

function seededRandom(seed: number): () => number {
	let value = seed >>> 0
	return () => {
		value = (value * 1_664_525 + 1_013_904_223) >>> 0
		return value / 4_294_967_296
	}
}

function lobby(playerCount: 2 | 3 | 4): HeartsState {
	let state = createHeartsGame("WIND", playerIds[0], "Ada", physicalIds())
	for (let index = 1; index < playerCount; index += 1) {
		state = joinHeartsGame(
			state,
			playerIds[index] as PlayerId,
			["Bea", "Cy", "Dee"][index - 1] as string,
		)
	}
	return state
}

function resolvePassing(state: HeartsState): HeartsState {
	if (state.phase !== "passing") return state
	let next = state
	for (const player of state.players) {
		next = submitPass(next, player.id, player.hand.slice(0, 3))
	}
	return next
}

function playRound(state: HeartsState): HeartsState {
	let next = resolvePassing(state)
	let safety = 0
	while (next.phase === "playing") {
		const playerId = next.currentPlayerId as PlayerId
		const cardId = playableCardIdsFor(next, playerId)[0] as CardId
		next = playCard(next, playerId, cardId)
		safety += 1
		if (safety > 60) throw new Error("Round did not terminate.")
	}
	return next
}

describe("Hearts dealing and visibility", () => {
	for (const playerCount of [2, 3, 4] as const) {
		it(`deals an even, playable deck to ${playerCount} players`, () => {
			const state = startGame(
				lobby(playerCount),
				playerIds[0],
				seededRandom(playerCount),
			)
			const expectedHandSize =
				playerCount === 2 ? 26 : playerCount === 3 ? 17 : 13
			expect(state.players.map((player) => player.hand.length)).toEqual(
				Array.from({ length: playerCount }, () => expectedHandSize),
			)
			expect(Object.keys(state.cardValues)).toHaveLength(
				expectedHandSize * playerCount,
			)
		})
	}

	it("keeps hidden values out of public state and other private hands", () => {
		const state = startGame(lobby(4), playerIds[0], seededRandom(42))
		const publicView = toPublicGameView(state)
		const firstPrivateView = toPrivatePlayerView(state, playerIds[0])
		const secondPrivateView = toPrivatePlayerView(state, playerIds[1])

		expect(JSON.stringify(publicView)).not.toContain('"rank"')
		expect(JSON.stringify(publicView)).not.toContain('"suit"')
		expect(firstPrivateView.cards).toHaveLength(13)
		expect(secondPrivateView.cards).toHaveLength(13)
		expect(
			firstPrivateView.cards.some((card) =>
				secondPrivateView.cards.some((other) => other.id === card.id),
			),
		).toBe(false)
	})

	it("scrambles card-value relationships on every deal", () => {
		const first = dealRound(lobby(4), seededRandom(1))
		const second = dealRound(first, seededRandom(2))
		const correlationsChanged = first.physicalCardIds.filter((cardId) => {
			const before = first.cardValues[cardId]
			const after = second.cardValues[cardId]
			return JSON.stringify(before) !== JSON.stringify(after)
		})
		expect(correlationsChanged.length).toBeGreaterThan(40)
	})
})

describe("Hearts rules", () => {
	it("requires the lowest club to lead the first trick", () => {
		const state = resolvePassing(
			startGame(lobby(4), playerIds[0], seededRandom(9)),
		)
		const playerId = state.currentPlayerId as PlayerId
		const playable = playableCardIdsFor(state, playerId)
		expect(playable).toHaveLength(1)
		const card = state.cardValues[playable[0] as CardId]
		expect(card?.suit).toBe("clubs")
		const everyClub = state.players
			.flatMap((player) => player.hand)
			.map((cardId) => state.cardValues[cardId])
			.filter((value) => value?.suit === "clubs")
		expect(card?.rank).toBe(
			Math.min(...everyClub.map((value) => value?.rank ?? 99)),
		)
	})

	it("requires a player to follow the led suit when possible", () => {
		let checked = false
		for (let seed = 1; seed < 30 && !checked; seed += 1) {
			let state = resolvePassing(
				startGame(lobby(4), playerIds[0], seededRandom(seed)),
			)
			const leader = state.currentPlayerId as PlayerId
			const leadCard = playableCardIdsFor(state, leader)[0] as CardId
			state = playCard(state, leader, leadCard)
			const follower = state.currentPlayerId as PlayerId
			const followerState = state.players.find(
				(player) => player.id === follower,
			)
			const clubs =
				followerState?.hand.filter(
					(cardId) => state.cardValues[cardId]?.suit === "clubs",
				) ?? []
			if (clubs.length === 0) continue
			expect(playableCardIdsFor(state, follower)).toEqual(clubs)
			checked = true
		}
		expect(checked).toBe(true)
	})

	for (const playerCount of [2, 3, 4] as const) {
		it(`plays a complete ${playerCount}-player round end to end`, () => {
			const initial = startGame(
				lobby(playerCount),
				playerIds[0],
				seededRandom(100 + playerCount),
			)
			const complete = playRound(initial)
			expect(["roundComplete", "gameComplete"]).toContain(complete.phase)
			expect(complete.players.every((player) => player.hand.length === 0)).toBe(
				true,
			)
			expect(
				complete.players.reduce(
					(total, player) => total + player.taken.length,
					0,
				),
			).toBe(playerCount === 3 ? 51 : 52)
		})
	}

	it("scores shooting the moon and ends the game at 100 points", () => {
		const state = resolvePassing(
			startGame(lobby(4), playerIds[0], seededRandom(77)),
		)
		const pointCards = Object.entries(state.cardValues)
			.filter(
				([, value]) =>
					value !== undefined &&
					(value.suit === "hearts" ||
						(value.suit === "spades" && value.rank === 12)),
			)
			.map(([cardId]) => cardId as CardId)
		const closingCards = Object.entries(state.cardValues)
			.filter(([, value]) => value?.suit === "clubs")
			.slice(0, 4)
			.map(([cardId]) => cardId as CardId)

		for (const player of state.players) {
			player.hand = []
			player.taken = []
		}
		state.players[0]!.taken = pointCards
		state.players[0]!.score = 74
		state.players[1]!.score = 75
		state.players[2]!.score = 80
		state.players[3]!.score = 90
		state.players[3]!.hand = [closingCards[3]!]
		state.currentTrick = closingCards.slice(0, 3).map((cardId, index) => ({
			cardId,
			playerId: playerIds[index]!,
		}))
		state.currentPlayerId = playerIds[3]
		state.trickLeaderId = playerIds[0]
		state.trickNumber = 12
		state.heartsBroken = true

		const complete = playCard(state, playerIds[3], closingCards[3]!)

		expect(complete.phase).toBe("gameComplete")
		expect(complete.players.map((player) => player.roundPoints)).toEqual([
			0, 26, 26, 26,
		])
		expect(complete.players.map((player) => player.score)).toEqual([
			74, 101, 106, 116,
		])
		expect(complete.winnerIds).toEqual([playerIds[0]])
	})
})
