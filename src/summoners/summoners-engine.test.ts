import { describe, expect, it } from "vitest"

import type { CardId, PlayerId } from "../game/game-types.ts"
import type { SummonersDeckId } from "./summoners-types.ts"
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

function twoPlayerGame(
	adaDeck: SummonersDeckId = "emberReliquary",
	beaDeck: SummonersDeckId = "verdantCompact",
): SummonersState {
	let state = createSummonersGame("MYTH", adaId, "Ada", physicalCardIds())
	state = joinSummonersGame(state, beaId, "Bea")
	state = selectSummonersDeck(state, adaId, adaDeck)
	state = selectSummonersDeck(state, beaId, beaDeck)
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

	it("keeps Verdant's efficient defenses within their tuned thresholds", () => {
		expect(summonersCardCatalog["barkhide-mouse"]).toMatchObject({
			attack: 1,
			energy: 4,
		})
		expect(summonersCardCatalog["rootwoven-buckler"]).toMatchObject({
			energy: 2,
		})
		expect(summonersCardCatalog["rootwoven-buckler"].grantedKeywords).toEqual([
			"rooted",
		])
		expect(summonersCardCatalog["green-reprisal"].effects).toEqual([
			{ amount: 4, kind: "damage", recipient: "target" },
		])
	})
})

describe("Summoners authoritative engine", () => {
	it("deals private hands without leaking their values into the public view", () => {
		const state = twoPlayerGame()
		const publicView = toSummonersPublicGameView(state)
		const privateView = toSummonersPrivatePlayerView(state, adaId)

		expect(publicView.phase).toBe("playing")
		expect(publicView.currentPlayerId).toBe(adaId)
		expect(publicView.revision).toBe(privateView.revision)
		expect(publicView.revision).toBe(state.revision)
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

	it("limits Tender Growth to repairing a friendly Being", () => {
		let state = endSummonersTurn(twoPlayerGame(), adaId)
		const bea = state.players[1] as SummonersPlayer
		bea.spark = 10
		const mouseId = moveCardToHand(state, bea, "barkhide-mouse")
		state = playSummonersCard(state, beaId, mouseId, null)
		state.players[1]!.battlefield[0]!.damage = 3

		expect(() =>
			useSummonerPower(state, beaId, {
				kind: "summoner",
				playerId: beaId,
			}),
		).toThrow("not a legal target")

		const healed = useSummonerPower(state, beaId, {
			cardId: mouseId,
			kind: "being",
			playerId: beaId,
		})
		expect(healed.players[1]?.battlefield[0]?.damage).toBe(1)
	})

	it("lets Blaze ready a Being once when its Summoner spends the last Spark", () => {
		let state = twoPlayerGame()
		let ada = state.players[0] as SummonersPlayer
		ada.spark = 10
		const ibexId = moveCardToHand(state, ada, "brasshorn-ibex")
		state = playSummonersCard(state, adaId, ibexId, null)
		state = endSummonersTurn(state, adaId)
		state = endSummonersTurn(state, beaId)

		state = attackSummoners(state, adaId, ibexId, {
			kind: "summoner",
			playerId: beaId,
		})
		ada = state.players[0] as SummonersPlayer
		ada.spark = 1
		const firstSparkId = moveCardToHand(state, ada, "spark-toss")
		state = playSummonersCard(state, adaId, firstSparkId, {
			kind: "summoner",
			playerId: beaId,
		})
		expect(state.players[0]?.battlefield[0]).toMatchObject({
			ready: true,
			triggeredKeywords: ["blaze"],
		})

		state = attackSummoners(state, adaId, ibexId, {
			kind: "summoner",
			playerId: beaId,
		})
		ada = state.players[0] as SummonersPlayer
		ada.spark = 1
		const secondSparkId = moveCardToHand(state, ada, "spark-toss")
		state = playSummonersCard(state, adaId, secondSparkId, {
			kind: "summoner",
			playerId: beaId,
		})
		expect(state.players[0]?.battlefield[0]?.ready).toBe(false)
	})

	it("lets Current turn only the first bonus draw into another attack", () => {
		let state = twoPlayerGame("tidemarkMenagerie", "emberReliquary")
		const ada = state.players[0] as SummonersPlayer
		ada.spark = 10
		const stoatId = moveCardToHand(state, ada, "icicle-stoat")
		const lensId = moveCardToHand(state, ada, "tideglass-lens")
		state = playSummonersCard(state, adaId, stoatId, null)
		state = playSummonersCard(state, adaId, lensId, {
			cardId: stoatId,
			kind: "being",
			playerId: adaId,
		})
		expect(state.players[0]?.battlefield[0]).toMatchObject({
			ready: true,
			triggeredKeywords: ["current"],
		})

		state = attackSummoners(state, adaId, stoatId, {
			kind: "summoner",
			playerId: beaId,
		})
		state = useSummonerPower(state, adaId, null)
		expect(state.players[0]?.battlefield[0]?.ready).toBe(false)
	})

	it("lets Molt permanently strengthen a Being after one survived combat", () => {
		let state = twoPlayerGame("outlandChorus", "emberReliquary")
		let ada = state.players[0] as SummonersPlayer
		ada.spark = 10
		const parasiteId = moveCardToHand(state, ada, "velvet-parasite")
		state = playSummonersCard(state, adaId, parasiteId, null)
		state = endSummonersTurn(state, adaId)

		const bea = state.players[1] as SummonersPlayer
		bea.spark = 10
		const tortoiseId = moveCardToHand(state, bea, "kilnback-tortoise")
		state = playSummonersCard(state, beaId, tortoiseId, null)
		state = endSummonersTurn(state, beaId)

		state = attackSummoners(state, adaId, parasiteId, {
			cardId: tortoiseId,
			kind: "being",
			playerId: beaId,
		})
		expect(
			toSummonersPublicGameView(state).players[0]?.battlefield[0],
		).toMatchObject({
			attack: 4,
			energy: 5,
			triggeredKeywords: ["molt"],
		})

		ada = state.players[0] as SummonersPlayer
		ada.battlefield[0]!.ready = true
		state = attackSummoners(state, adaId, parasiteId, {
			cardId: tortoiseId,
			kind: "being",
			playerId: beaId,
		})
		expect(
			toSummonersPublicGameView(state).players[0]?.battlefield[0],
		).toMatchObject({
			attack: 4,
			energy: 5,
		})
	})

	it("lets a ready Rooted defender recover as its Summoner ends the turn", () => {
		let state = twoPlayerGame("verdantCompact", "emberReliquary")
		const ada = state.players[0] as SummonersPlayer
		ada.spark = 10
		const mouseId = moveCardToHand(state, ada, "barkhide-mouse")
		state = playSummonersCard(state, adaId, mouseId, null)
		state.players[0]!.battlefield[0]!.damage = 3

		state = endSummonersTurn(state, adaId)
		expect(state.players[0]?.battlefield[0]?.damage).toBe(3)
		state = endSummonersTurn(state, beaId)
		state = endSummonersTurn(state, adaId)
		expect(state.players[0]?.battlefield[0]?.damage).toBe(1)
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
