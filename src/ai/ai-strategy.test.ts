import { Squirrel } from "varmint"
import { describe, expect, it, vi } from "vitest"

import {
	EMPTY_HEARTS_PRIVATE_PLAYER_VIEW,
	type CardId,
	type HeartsPrivatePlayerView,
	type HeartsPublicGameView,
	type OhHellPrivatePlayerView,
	type OhHellPublicGameView,
	type PlayerId,
	type VisibleCard,
} from "../game/game-types.ts"
import { renderAiGameFacts, type AiGameContext } from "./ai-game-facts.ts"
import { aiGameStrategy } from "./ai-game-strategy.ts"
import { wrapAiGeneratorWithVarmint } from "./ai-generator.node.ts"
import { isAiTurnReady } from "./ai-player.node.ts"
import {
	chooseFallbackAiAction,
	createGuardedAiTurnGenerator,
} from "./ai-strategy.ts"

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
	privateOverrides: Partial<HeartsPrivatePlayerView>,
	overrides: Partial<HeartsPublicGameView> = {},
): AiGameContext {
	const privateView: HeartsPrivatePlayerView = {
		...EMPTY_HEARTS_PRIVATE_PLAYER_VIEW,
		...privateOverrides,
	}
	const publicView: HeartsPublicGameView = {
		completedTricks: [],
		currentPlayerId: aiPlayerId,
		currentTrick: [],
		deckCardIds: [],
		gameKind: "hearts",
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
		memoryLedger: [],
		observations: [],
		playerId: aiPlayerId,
		previousPlan: "",
		privateView,
		publicView,
	}
}

function ohHellContext(
	cards: VisibleCard[],
	options: { bid: number; tricksWon: number },
): AiGameContext {
	const privateView: OhHellPrivatePlayerView = {
		cards,
		gameKind: "ohHell",
		legalBids: [],
		playableCardIds: cards.map((entry) => entry.id),
		playerId: aiPlayerId,
	}
	const publicView: OhHellPublicGameView = {
		bidPlayerId: null,
		bidsSubmitted: 2,
		completedTricks: [],
		currentPlayerId: aiPlayerId,
		currentTrick: [],
		dealerId: humanPlayerId,
		deckCardIds: [],
		gameKind: "ohHell",
		hostId: humanPlayerId,
		lastTrickWinnerId: null,
		maximumRounds: 5,
		phase: "playing",
		players: [
			{
				aiModel: "gpt-5.6-terra",
				bid: options.bid,
				connected: true,
				handCardIds: cards.map((entry) => entry.id),
				id: aiPlayerId,
				kind: "ai",
				name: "Terra AI",
				roundPoints: 0,
				score: 0,
				tricksWon: options.tricksWon,
			},
			{
				aiModel: null,
				bid: 0,
				connected: true,
				handCardIds: [],
				id: humanPlayerId,
				kind: "human",
				name: "Ada",
				roundPoints: 0,
				score: 0,
				tricksWon: 0,
			},
		],
		roomCode: "WIND",
		roundHandSize: cards.length,
		roundNumber: 1,
		statusMessage: "Your play.",
		trickLeaderId: aiPlayerId,
		trickNumber: 0,
		trumpSuit: "spades",
		winnerIds: [],
	}
	return {
		memoryLedger: [],
		observations: [],
		playerId: aiPlayerId,
		previousPlan: "",
		privateView,
		publicView,
	}
}

describe("AI Hearts generators", () => {
	it("uses an OpenAI-compatible structured-output schema", () => {
		const strategy = aiGameStrategy("hearts")
		const outputSchema = strategy.outputSchema
		expect(outputSchema).toMatchObject({
			properties: {
				nextAction: {
					anyOf: [
						{
							properties: {
								action: { enum: ["passCards"], type: "string" },
								cards: { maxItems: 3, minItems: 3, type: "array" },
							},
							type: "object",
						},
						{
							properties: {
								action: { enum: ["playCard"], type: "string" },
								card: { type: "string" },
							},
							type: "object",
						},
					],
				},
			},
			type: "object",
		})
		expect(JSON.stringify(outputSchema)).not.toContain("uniqueItems")
		expect(
			strategy.parseDecision({
				currentPlan: "Bid.",
				nextAction: { action: "submitBid", bid: 1 },
				observation: "A bid is available.",
			}).ok,
		).toBe(false)
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

	it("renders natural Hearts facts using literal card values only", () => {
		const ownCard = card("own-queen", "spades", 12)
		const facts = renderAiGameFacts(
			gameContext({
				cards: [ownCard],
				passSubmitted: false,
				playableCardIds: [ownCard.id],
				playerId: aiPlayerId,
			}),
		)

		expect(facts).toContain("Your hand: QS.")
		expect(facts).toContain("Legal plays: QS.")
		expect(facts).toContain("P0 (you), Terra AI: score 0")
		expect(facts).not.toContain("card::opaque-opponent-card")
		expect(facts).not.toContain("card::own-queen")
		expect(facts).not.toContain("AI:gpt")
	})

	it("renders exact private transfers and completed public tricks as memory", () => {
		const passedKing = card("passed-king", "hearts", 13)
		const receivedQueen = card("received-queen", "hearts", 12)
		const completedCard = card("completed-two", "clubs", 2)
		const context = gameContext(
			{
				cards: [receivedQueen],
				passSubmitted: true,
				playableCardIds: [receivedQueen.id],
				playerId: aiPlayerId,
			},
			{
				completedTricks: [
					{
						leftoverAward: null,
						plays: [{ card: completedCard, playerId: humanPlayerId }],
						winnerId: humanPlayerId,
					},
				],
			},
		)
		context.memoryLedger = [
			{
				cards: [passedKing],
				direction: "left",
				kind: "cardsPassed",
				recipientId: humanPlayerId,
				roundNumber: 1,
			},
			{
				cards: [receivedQueen],
				direction: "left",
				kind: "cardsReceived",
				roundNumber: 1,
				senderId: humanPlayerId,
			},
		]

		const facts = renderAiGameFacts(context)

		expect(facts).toContain("Gave P1 KH.")
		expect(facts).toContain("Received QH from P1.")
		expect(facts).toContain("1. P1 2C. P1 won.")
		expect(facts).not.toContain("card::passed-king")
		expect(facts).not.toContain("card::completed-two")
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
			cards: ["QS", "AH", "KH"],
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
			card: "TC",
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
		const onFallback = vi.fn()
		const generate = createGuardedAiTurnGenerator(
			async () => ({
				currentPlan: "Cheat.",
				nextAction: {
					action: "playCard",
					card: "AS",
				},
				observation: "I can see hidden cards.",
			}),
			{ onFallback },
		)

		await expect(generate(context)).resolves.toMatchObject({
			nextAction: { action: "playCard", card: "2C" },
		})
		expect(onFallback).toHaveBeenCalledWith(
			expect.objectContaining({
				generated: {
					currentPlan: "Cheat.",
					nextAction: {
						action: "playCard",
						card: "AS",
					},
					observation: "I can see hidden cards.",
				},
				reason: "illegal_action",
			}),
		)
	})

	it("stores the rendered prompt directly in Varmint input fixtures", async () => {
		const two = card("two-clubs", "clubs", 2)
		const leftover = card("leftover", "spades", 12)
		const context = gameContext(
			{
				awardedLeftoverCard: leftover,
				cards: [two],
				passSubmitted: false,
				playableCardIds: [two.id],
				playerId: aiPlayerId,
			},
			{
				completedTricks: [
					{
						leftoverAward: {
							cardId: leftover.id,
							recipientId: aiPlayerId,
						},
						plays: [{ card: two, playerId: aiPlayerId }],
						winnerId: aiPlayerId,
					},
				],
				deckCardIds: [leftover.id],
			},
		)
		const base = vi.fn(async (_context: AiGameContext) => ({
			currentPlan: "Lead the required lowest club.",
			nextAction: { action: "playCard" as const, card: "2C" as const },
			observation: "The opening lead is forced.",
		}))
		const cacheDirectory = await mkdtemp(join(tmpdir(), "wayfarer-prompt-"))
		try {
			const wrapped = wrapAiGeneratorWithVarmint(
				"unit-test",
				base,
				new Squirrel("write", cacheDirectory),
			)

			await expect(wrapped(context)).resolves.toMatchObject({
				nextAction: { card: "2C" },
			})
			expect(base).toHaveBeenCalledOnce()
			expect(base).toHaveBeenCalledWith(context)
			const input = JSON.parse(
				await readFile(
					join(
						cacheDirectory,
						"unit-test",
						"round-1-trick-3-play-1-P0.input.json",
					),
					"utf8",
				),
			)
			expect(input).toEqual([renderAiGameFacts(context)])
			expect(JSON.stringify(input)).not.toContain("privateView")
			expect(JSON.stringify(input)).not.toContain("card::")
		} finally {
			await rm(cacheDirectory, { force: true, recursive: true })
		}
	})
})

describe("AI Oh Hell strategy", () => {
	it("uses an Oh Hell prompt and targets the exact bid", () => {
		const low = card("low-club", "clubs", 2)
		const trump = card("ace-spade", "spades", 14)
		const strategy = aiGameStrategy("ohHell")
		const facts = renderAiGameFacts(
			ohHellContext([low, trump], { bid: 1, tricksWon: 0 }),
		)

		expect(strategy.systemPrompt).toContain("strategic Oh Hell player")
		expect(strategy.systemPrompt).not.toContain("minimize expected points")
		expect(facts).toContain("choose one listed legal card value")
		expect(facts).not.toContain("card::")
		expect(facts).not.toContain("during passing")
		expect(JSON.stringify(strategy.outputSchema)).toContain("submitBid")
		expect(JSON.stringify(strategy.outputSchema)).not.toContain("passCards")
		expect(
			strategy.parseDecision({
				currentPlan: "Pass.",
				nextAction: { action: "passCards", cards: ["2C"] },
				observation: "Cards can be passed.",
			}).ok,
		).toBe(false)
		expect(
			strategy.parseDecision({
				currentPlan: "Bid one.",
				nextAction: { action: "submitBid", bid: 1 },
				observation: "One is legal.",
			}).ok,
		).toBe(true)
		expect(
			chooseFallbackAiAction(
				ohHellContext([low, trump], { bid: 1, tricksWon: 0 }),
			),
		).toEqual({ action: "playCard", card: "AS" })
		expect(
			chooseFallbackAiAction(
				ohHellContext([low, trump], { bid: 1, tricksWon: 1 }),
			),
		).toEqual({ action: "playCard", card: "2C" })
	})
})
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
