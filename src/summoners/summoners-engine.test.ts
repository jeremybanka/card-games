import { describe, expect, it } from "vitest"

import type { CardId, PlayerId } from "../game/game-types.ts"
import {
	SUMMONERS_DECK_IDS,
	summonersCardCatalog,
	summonersStarterDecks,
} from "./summoners-cards.ts"
import {
	attackSummoners,
	createSummonersGame,
	createSummonersPhysicalCardIds,
	endSummonersTurn,
	joinSummonersGame,
	playSummonersCard,
	selectSummonersDeck,
	startSummonersGame,
	toSummonersPrivatePlayerView,
	toSummonersPublicGameView,
	type SummonersPlayer,
	type SummonersState,
	useSummonerPower,
} from "./summoners-engine.ts"

const adaId = "user::summoner-ada" satisfies PlayerId
const beaId = "user::summoner-bea" satisfies PlayerId

function physicalCardIds(): CardId[] {
	let index = 0
	return createSummonersPhysicalCardIds(() => `summoners-${index++}`)
}

function twoPlayerGame(): SummonersState {
	let state = createSummonersGame("MYTH", adaId, "Ada", physicalCardIds())
	state = joinSummonersGame(state, beaId, "Bea")
	state = selectSummonersDeck(state, adaId, "emberReliquary")
	state = selectSummonersDeck(state, beaId, "verdantCompact")
	return startSummonersGame(state, adaId, () => 0.375)
}

function moveCardToHand(
	state: SummonersState,
	player: SummonersPlayer,
	blueprintId: string,
): CardId {
	const cardId = [...player.hand, ...player.deck].find(
		(candidate) => state.cardBlueprintById[candidate] === blueprintId,
	)
	if (cardId === undefined) {
		throw new Error(`${blueprintId} is not in ${player.name}'s library.`)
	}
	player.hand = player.hand.filter((candidate) => candidate !== cardId)
	player.deck = player.deck.filter((candidate) => candidate !== cardId)
	player.hand.push(cardId)
	return cardId
}

describe("Summoners card set", () => {
	it("ships four complete 24-card starter decks", () => {
		expect(SUMMONERS_DECK_IDS).toHaveLength(4)
		for (const deck of Object.values(summonersStarterDecks)) {
			expect(deck.cardIds).toHaveLength(24)
			for (const cardId of deck.cardIds) {
				expect(summonersCardCatalog).toHaveProperty(cardId)
			}
		}
	})
})

describe("Summoners authoritative engine", () => {
	it("deals private hands without leaking their values into the public view", () => {
		const state = twoPlayerGame()
		const publicView = toSummonersPublicGameView(state)
		const privateView = toSummonersPrivatePlayerView(state, adaId)

		expect(publicView.phase).toBe("playing")
		expect(publicView.currentPlayerId).toBe(adaId)
		expect(publicView.players[0]).toMatchObject({
			deckCount: 19,
			handCount: 5,
			health: 24,
			maxSpark: 1,
			spark: 1,
		})
		expect(publicView.players[0]).not.toHaveProperty("hand")
		expect(publicView.players[0]?.handCardIds).toEqual(state.players[0]?.hand)
		expect(publicView.players[0]?.handCardIds).toHaveLength(5)
		expect(publicView.players[0]?.handCardIds[0]).toMatch(/^card::/)
		expect(privateView.hand).toHaveLength(5)
		expect(privateView.hand[0]).toMatchObject({
			name: expect.any(String),
			physicalId: expect.stringMatching(/^card::/),
		})
	})

	it("lets a Rush Being attack immediately and keeps the server in charge of turn order", () => {
		const state = twoPlayerGame()
		const ada = state.players[0] as SummonersPlayer
		ada.spark = 10
		const cubId = moveCardToHand(state, ada, "coalcoat-cub")

		const summoned = playSummonersCard(state, adaId, cubId, null)
		expect(summoned.players[0]?.battlefield[0]).toMatchObject({
			cardId: cubId,
			ready: true,
		})

		const attacked = attackSummoners(summoned, adaId, cubId, {
			kind: "summoner",
			playerId: beaId,
		})
		expect(attacked.players[1]?.health).toBe(22)
		expect(attacked.players[0]?.battlefield[0]?.ready).toBe(false)
		expect(() =>
			attackSummoners(attacked, beaId, cubId, {
				kind: "summoner",
				playerId: adaId,
			}),
		).toThrow("Wait for your turn")
	})

	it("requires attackers to confront Guard Beings before other characters", () => {
		let state = twoPlayerGame()
		const ada = state.players[0] as SummonersPlayer
		ada.spark = 10
		const cubId = moveCardToHand(state, ada, "coalcoat-cub")
		state = playSummonersCard(state, adaId, cubId, null)
		state = endSummonersTurn(state, adaId)

		const bea = state.players[1] as SummonersPlayer
		bea.spark = 10
		const mouseId = moveCardToHand(state, bea, "barkhide-mouse")
		state = playSummonersCard(state, beaId, mouseId, null)
		state = endSummonersTurn(state, beaId)

		expect(() =>
			attackSummoners(state, adaId, cubId, {
				kind: "summoner",
				playerId: beaId,
			}),
		).toThrow("A Guard must be attacked first")
		const battled = attackSummoners(state, adaId, cubId, {
			cardId: mouseId,
			kind: "being",
			playerId: beaId,
		})
		expect(battled.players[1]?.battlefield[0]?.damage).toBe(2)
	})

	it("validates targeted Items, Spells, and once-per-turn Summoner powers", () => {
		const state = twoPlayerGame()
		const ada = state.players[0] as SummonersPlayer
		ada.spark = 10
		const cubId = moveCardToHand(state, ada, "coalcoat-cub")
		const knifeId = moveCardToHand(state, ada, "frontier-flareknife")
		const sparkId = moveCardToHand(state, ada, "spark-toss")
		let next = playSummonersCard(state, adaId, cubId, null)

		expect(() =>
			playSummonersCard(next, adaId, knifeId, {
				kind: "summoner",
				playerId: adaId,
			}),
		).toThrow("not a legal target")
		next = playSummonersCard(next, adaId, knifeId, {
			cardId: cubId,
			kind: "being",
			playerId: adaId,
		})
		expect(
			toSummonersPublicGameView(next).players[0]?.battlefield[0]?.attack,
		).toBe(4)

		next = playSummonersCard(next, adaId, sparkId, {
			kind: "summoner",
			playerId: beaId,
		})
		expect(next.players[1]?.health).toBe(22)
		next = useSummonerPower(next, adaId, {
			kind: "summoner",
			playerId: beaId,
		})
		expect(next.players[1]?.health).toBe(21)
		expect(() =>
			useSummonerPower(next, adaId, {
				kind: "summoner",
				playerId: beaId,
			}),
		).toThrow("already used")
	})
})
