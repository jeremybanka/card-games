import { Squirrel } from "varmint"
import { describe, expect, it, vi } from "vitest"

import type {
	CardId,
	PlayerId,
	PrivatePlayerView,
	PublicGameView,
	VisibleCard,
} from "../game/hearts-types.ts"
import { renderAiGameFacts, type AiGameContext } from "./ai-game-facts.ts"
import { wrapAiGeneratorWithVarmint } from "./ai-generator.node.ts"
import { isAiTurnReady } from "./ai-player.node.ts"
import {
	chooseFallbackAiAction,
	createGuardedAiTurnGenerator,
} from "./ai-strategy.ts"
import { aiTurnDecisionJsonSchema } from "./ai-types.ts"

const aiPlayerId =
	"user::00000000-0000-4000-8000-0000000000a1" satisfies PlayerId
const humanPlayerId =
	"user::00000000-0000-4000-8000-0000000000b2" satisfies PlayerId

function card(
	id: string,
	suit: VisibleCard["suit"],
	rank: VisibleCard["rank"],
): VisibleCard {
	return { id: `card::${id}` satisfies CardId, rank, suit }
}

function gameContext(
	privateView: PrivatePlayerView,
	overrides: Partial<PublicGameView> = {},
): AiGameContext {
	const publicView: PublicGameView = {
		currentPlayerId: aiPlayerId,
		currentTrick: [],
		heartsBroken: false,
		hostId: humanPlayerId,
		lastTrickWinnerId: null,
		passDirection: "across",
		passSubmittedPlayerIds: [],
		phase: "playing",
		players: [
			{
				aiModel: "gpt-5.6-terra",
				capturedCardIds: [],
				connected: true,
				handCardIds: privateView.cards.map((entry) => entry.id),
				id: aiPlayerId,
				kind: "ai",
				name: "Terra AI",
				roundPoints: 0,
				score: 0,
			},
			{
				aiModel: null,
				capturedCardIds: [],
				connected: true,
				handCardIds: ["card::opaque-opponent-card"],
				id: humanPlayerId,
				kind: "human",
				name: "Ada",
				roundPoints: 0,
				score: 0,
			},
		],
		roomCode: "WIND",
		roundNumber: 1,
		statusMessage: "Your play.",
		trickLeaderId: aiPlayerId,
		trickNumber: 2,
		winnerIds: [],
		...overrides,
	}
	return {
		observations: [],
		playerId: aiPlayerId,
		previousPlan: "",
		privateView,
		publicView,
	}
}

describe("AI Hearts generators", () => {
	it("uses an OpenAI-compatible structured-output schema", () => {
		expect(aiTurnDecisionJsonSchema).toMatchObject({
			properties: {
				nextAction: {
					anyOf: [
						{
							properties: {
								action: { enum: ["passCards"], type: "string" },
								cardIds: { maxItems: 3, minItems: 3, type: "array" },
							},
							type: "object",
						},
						{
							properties: {
								action: { enum: ["playCard"], type: "string" },
								cardId: { type: "string" },
							},
							type: "object",
						},
					],
				},
			},
			type: "object",
		})
		expect(JSON.stringify(aiTurnDecisionJsonSchema)).not.toContain(
			"uniqueItems",
		)
	})

	it("waits for the private hand before starting an AI pass", () => {
		const context = gameContext(
			{
				cards: [],
				passSubmitted: false,
				playableCardIds: [],
				playerId: aiPlayerId,
			},
			{ phase: "passing" },
		)
		expect(
			isAiTurnReady(aiPlayerId, context.publicView, context.privateView),
		).toBe(false)

		const cards = [
			card("two-clubs", "clubs", 2),
			card("three-clubs", "clubs", 3),
			card("four-clubs", "clubs", 4),
		]
		expect(
			isAiTurnReady(aiPlayerId, context.publicView, {
				...context.privateView,
				cards,
			}),
		).toBe(true)
	})

	it("renders useful facts without exposing opaque opponent card identities", () => {
		const ownCard = card("own-queen", "spades", 12)
		const facts = renderAiGameFacts(
			gameContext({
				cards: [ownCard],
				passSubmitted: false,
				playableCardIds: [ownCard.id],
				playerId: aiPlayerId,
			}),
		)

		expect(facts).toContain("queen of spades [card::own-queen]")
		expect(facts).toContain("1 cards in hand")
		expect(facts).not.toContain("card::opaque-opponent-card")
	})

	it("passes the queen of spades and highest hearts first", () => {
		const cards = [
			card("qs", "spades", 12),
			card("ah", "hearts", 14),
			card("kh", "hearts", 13),
			card("two-clubs", "clubs", 2),
		]
		const action = chooseFallbackAiAction(
			gameContext(
				{
					cards,
					passSubmitted: false,
					playableCardIds: [],
					playerId: aiPlayerId,
				},
				{ phase: "passing" },
			),
		)

		expect(action).toEqual({
			action: "passCards",
			cardIds: ["card::qs", "card::ah", "card::kh"],
		})
	})

	it("plays the highest card that remains below the current winner", () => {
		const five = card("five-clubs", "clubs", 5)
		const ten = card("ten-clubs", "clubs", 10)
		const context = gameContext(
			{
				cards: [five, ten],
				passSubmitted: false,
				playableCardIds: [five.id, ten.id],
				playerId: aiPlayerId,
			},
			{
				currentTrick: [
					{
						card: card("jack-clubs", "clubs", 11),
						playerId: humanPlayerId,
					},
				],
			},
		)

		expect(chooseFallbackAiAction(context)).toEqual({
			action: "playCard",
			cardId: ten.id,
		})
	})

	it("replaces an invalid model action with a legal strategic fallback", async () => {
		const two = card("two-clubs", "clubs", 2)
		const context = gameContext({
			cards: [two],
			passSubmitted: false,
			playableCardIds: [two.id],
			playerId: aiPlayerId,
		})
		const generate = createGuardedAiTurnGenerator(async () => ({
			currentPlan: "Cheat.",
			nextAction: {
				action: "playCard",
				cardId: "card::not-in-hand",
			},
			observation: "I can see hidden cards.",
		}))

		await expect(generate(context)).resolves.toMatchObject({
			nextAction: { action: "playCard", cardId: two.id },
		})
	})

	it("runs structured generators through Varmint", async () => {
		const two = card("two-clubs", "clubs", 2)
		const context = gameContext({
			cards: [two],
			passSubmitted: false,
			playableCardIds: [two.id],
			playerId: aiPlayerId,
		})
		const base = vi.fn(async () => ({
			currentPlan: "Lead the required lowest club.",
			nextAction: { action: "playCard" as const, cardId: two.id },
			observation: "The opening lead is forced.",
		}))
		const wrapped = wrapAiGeneratorWithVarmint(
			"unit-test",
			base,
			new Squirrel("off"),
		)

		await expect(wrapped(context)).resolves.toMatchObject({
			nextAction: { cardId: two.id },
		})
		expect(base).toHaveBeenCalledOnce()
	})
})
