import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

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
import { STANDARD_PAGAT_OH_HELL_RULES } from "../game/oh-hell-rules.ts"
import {
	renderAiGameFacts,
	type AiGameContext,
	type AiGameContextFor,
} from "./ai-game-facts.ts"
import { aiGameStrategy } from "./ai-game-strategy.ts"
import {
	AiGenerationTimeoutError,
	aiGenerationContract,
	generateAiWithDeadline,
	promptFixtureKey,
	retryAiGeneration,
	wrapAiGeneratorWithVarmint,
} from "./ai-generator.node.ts"
import { isAiTurnReady } from "./ai-player.node.ts"
import {
	chooseFallbackAiAction,
	createGuardedAiTurnGenerator,
} from "./ai-strategy.ts"

const aiPlayerId =
	"user::00000000-0000-4000-8000-0000000000a1" satisfies PlayerId
const humanPlayerId =
	"user::00000000-0000-4000-8000-0000000000b2" satisfies PlayerId
const opponentPlayerId =
	"user::00000000-0000-4000-8000-0000000000c3" satisfies PlayerId

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
): AiGameContextFor<"hearts"> {
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
		playerId: aiPlayerId,
		previousPlan: "",
		privateView,
		publicView,
	}
}

function ohHellContext(
	cards: VisibleCard[],
	options: { bid: number; tricksWon: number },
): AiGameContextFor<"ohHell"> {
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
		rules: structuredClone(STANDARD_PAGAT_OH_HELL_RULES),
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
		playerId: aiPlayerId,
		previousPlan: "",
		privateView,
		publicView,
	}
}

function ohHellBiddingContext(
	cards: VisibleCard[],
	options: {
		dealerId?: PlayerId
		legalBids?: number[]
	},
): AiGameContextFor<"ohHell"> {
	const dealerId = options.dealerId ?? opponentPlayerId
	return {
		memoryLedger: [],
		playerId: aiPlayerId,
		previousPlan: "",
		privateView: {
			cards,
			gameKind: "ohHell",
			legalBids: options.legalBids ?? [0, 1, 2, 3, 4],
			playableCardIds: [],
			playerId: aiPlayerId,
		},
		publicView: {
			bidPlayerId: aiPlayerId,
			bidsSubmitted: dealerId === aiPlayerId ? 2 : 1,
			completedTricks: [],
			currentPlayerId: aiPlayerId,
			currentTrick: [],
			dealerId,
			deckCardIds: [],
			gameKind: "ohHell",
			hostId: humanPlayerId,
			lastTrickWinnerId: null,
			maximumRounds: 5,
			phase: "bidding",
			players: [
				{
					aiModel: null,
					bid: 1,
					connected: true,
					handCardIds: ["card::opaque-human-card"],
					id: humanPlayerId,
					kind: "human",
					name: "Ada",
					roundPoints: 0,
					score: 10,
					tricksWon: 0,
				},
				{
					aiModel: "gpt-5.6-terra",
					bid: null,
					connected: true,
					handCardIds: cards.map((entry) => entry.id),
					id: aiPlayerId,
					kind: "ai",
					name: "Terra AI",
					roundPoints: 0,
					score: 12,
					tricksWon: 0,
				},
				{
					aiModel: "gpt-5.6-terra",
					bid: dealerId === aiPlayerId ? 2 : null,
					connected: true,
					handCardIds: ["card::opaque-opponent-card"],
					id: opponentPlayerId,
					kind: "ai",
					name: "Terra AI 2",
					roundPoints: 0,
					score: 3,
					tricksWon: 0,
				},
			],
			rules: structuredClone(STANDARD_PAGAT_OH_HELL_RULES),
			roomCode: "WIND",
			roundHandSize: cards.length,
			roundNumber: 2,
			statusMessage: "Terra AI to bid.",
			trickLeaderId: null,
			trickNumber: 0,
			trumpSuit: "hearts",
			winnerIds: [],
		},
	}
}

function ohHellPlayingContext(
	cards: VisibleCard[],
): AiGameContextFor<"ohHell"> {
	const context = ohHellBiddingContext(cards, {})
	const queenSpade = card("queen-spade", "spades", 12)
	const aceDiamond = card("ace-diamond", "diamonds", 14)
	const threeDiamond = card("three-diamond-played", "diamonds", 3)
	const sevenDiamond = card("seven-diamond", "diamonds", 7)
	context.previousPlan =
		"Bid 1. Preserve AS for a reliable trump trick; after reaching the bid, shed KC and avoid taking extras."
	context.privateView.legalBids = []
	context.privateView.playableCardIds = cards
		.filter((entry) => entry.suit === "spades")
		.map((entry) => entry.id)
	context.publicView.bidsSubmitted = 3
	context.publicView.completedTricks = [
		{
			leftoverAward: null,
			plays: [
				{ card: aceDiamond, playerId: humanPlayerId },
				{ card: threeDiamond, playerId: aiPlayerId },
				{ card: sevenDiamond, playerId: opponentPlayerId },
			],
			winnerId: humanPlayerId,
		},
	]
	context.publicView.currentTrick = [
		{ card: queenSpade, playerId: humanPlayerId },
	]
	context.publicView.phase = "playing"
	const player0 = context.publicView.players[0]
	const player1 = context.publicView.players[1]
	const player2 = context.publicView.players[2]
	if (player0 === undefined || player1 === undefined || player2 === undefined) {
		throw new Error("The Oh Hell play fixture requires three players.")
	}
	context.publicView.players[0] = {
		...player0,
		bid: 1,
		handCardIds: [
			"card::opaque-human-1",
			"card::opaque-human-2",
			"card::opaque-human-3",
		],
		tricksWon: 1,
	}
	context.publicView.players[1] = {
		...player1,
		bid: 1,
		tricksWon: 0,
	}
	context.publicView.players[2] = {
		...player2,
		bid: 2,
		handCardIds: [
			"card::opaque-opponent-1",
			"card::opaque-opponent-2",
			"card::opaque-opponent-3",
		],
		tricksWon: 0,
	}
	context.publicView.roundHandSize = 4
	context.publicView.statusMessage = "Terra AI plays."
	context.publicView.trickLeaderId = humanPlayerId
	context.publicView.trickNumber = 1
	context.publicView.trumpSuit = "spades"
	return context
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
		expect(facts).toContain("Legal plays: QS (leads).")
		expect(facts).toContain("P0 (you), Terra AI: score 0")
		expect(facts).not.toContain("card::opaque-opponent-card")
		expect(facts).not.toContain("card::own-queen")
		expect(facts).not.toContain("AI:gpt")
	})

	it("labels the deterministic meaning of every legal Hearts play", () => {
		const ten = card("ten-clubs", "clubs", 10)
		const queen = card("queen-clubs", "clubs", 12)
		const jack = card("jack-clubs", "clubs", 11)
		const finalPlay = renderAiGameFacts(
			gameContext(
				{
					cards: [ten, queen],
					passSubmitted: false,
					playableCardIds: [ten.id, queen.id],
					playerId: aiPlayerId,
				},
				{
					currentTrick: [{ card: jack, playerId: humanPlayerId }],
				},
			),
		)

		expect(finalPlay).toContain("TC (ducks JC)")
		expect(finalPlay).toContain("QC (takes the trick; 0 points)")

		const queenHeart = card("queen-heart", "hearts", 12)
		const aceDiamond = card("ace-diamond", "diamonds", 14)
		const offSuit = renderAiGameFacts(
			gameContext(
				{
					cards: [queenHeart, aceDiamond],
					passSubmitted: false,
					playableCardIds: [queenHeart.id, aceDiamond.id],
					playerId: aiPlayerId,
				},
				{
					currentTrick: [
						{
							card: card("eight-spades", "spades", 8),
							playerId: humanPlayerId,
						},
					],
				},
			),
		)

		expect(offSuit).toContain("QH (discards 1 point; cannot win)")
		expect(offSuit).toContain("AD (discards; cannot win)")

		const eightDiamond = card("eight-diamond", "diamonds", 8)
		const overtakeContext = gameContext(
			{
				cards: [eightDiamond],
				passSubmitted: false,
				playableCardIds: [eightDiamond.id],
				playerId: aiPlayerId,
			},
			{
				currentTrick: [
					{
						card: card("seven-diamond", "diamonds", 7),
						playerId: humanPlayerId,
					},
				],
			},
		)
		const heartsOvertakeContext = overtakeContext as AiGameContextFor<"hearts">
		const opponent = heartsOvertakeContext.publicView.players[1]!
		heartsOvertakeContext.publicView.players.push(
			{
				...opponent,
				id: "user::00000000-0000-4000-8000-0000000000c3",
				name: "Grace",
			},
			{
				...opponent,
				id: "user::00000000-0000-4000-8000-0000000000d4",
				name: "Linus",
			},
		)

		expect(renderAiGameFacts(overtakeContext)).toContain(
			"8D (overtakes 7D; 2 players remain)",
		)
	})

	it("names the pass recipient and sender explicitly", () => {
		const context = gameContext(
			{
				cards: [],
				passSubmitted: false,
				playableCardIds: [],
				playerId: aiPlayerId,
			},
			{ passDirection: "across", phase: "passing" },
		)

		expect(renderAiGameFacts(context)).toContain(
			"You pass to P1 and receive from P1.",
		)
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
				},
				reason: "illegal_action",
			}),
		)
	})

	it("stores only the prompt while hashing the full generation contract", async () => {
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
		}))
		const cacheDirectory = await mkdtemp(join(tmpdir(), "wayfarer-prompt-"))
		try {
			const modelId = "gpt-5.6-sol"
			const wrapped = wrapAiGeneratorWithVarmint(
				"unit-test",
				modelId,
				base,
				new Squirrel("write", cacheDirectory),
			)

			await expect(wrapped(context)).resolves.toMatchObject({
				nextAction: { card: "2C" },
			})
			expect(base).toHaveBeenCalledOnce()
			expect(base).toHaveBeenCalledWith(context)
			const prompt = renderAiGameFacts(context)
			const contract = aiGenerationContract("hearts", modelId, prompt)
			const inputHash = createHash("sha256")
				.update(JSON.stringify(contract))
				.digest("hex")
				.slice(0, 12)
			expect(promptFixtureKey(context, contract)).toBe(
				`round-1-trick-3-play-1-P0--${inputHash}`,
			)
			expect(
				promptFixtureKey(
					context,
					aiGenerationContract("hearts", modelId, `${prompt}\nchanged`),
				),
			).not.toBe(promptFixtureKey(context, contract))
			expect(
				promptFixtureKey(context, {
					...contract,
					system: `${contract.system}\nChanged.`,
				}),
			).not.toBe(promptFixtureKey(context, contract))
			expect(
				promptFixtureKey(context, {
					...contract,
					output: {
						...contract.output,
						description: `${contract.output.description} Changed.`,
					},
				}),
			).not.toBe(promptFixtureKey(context, contract))
			expect(
				promptFixtureKey(context, {
					...contract,
					providerOptions: {
						openai: {
							...contract.providerOptions.openai,
							reasoningEffort: "medium",
						},
					},
				}),
			).not.toBe(promptFixtureKey(context, contract))
			const input = JSON.parse(
				await readFile(
					join(
						cacheDirectory,
						"unit-test",
						`${promptFixtureKey(context, contract)}.input.json`,
					),
					"utf8",
				),
			)
			expect(input).toEqual([prompt])
			expect(JSON.stringify(input)).not.toContain("privateView")
			expect(JSON.stringify(input)).not.toContain("card::")
		} finally {
			await rm(cacheDirectory, { force: true, recursive: true })
		}
	})

	it("retries a failed model generation once and returns the retry", async () => {
		const generate = vi
			.fn<(attempt: number) => Promise<string>>()
			.mockRejectedValueOnce(new Error("request timed out"))
			.mockResolvedValueOnce("recovered")
		const onRetry = vi.fn()

		await expect(retryAiGeneration(generate, 2, onRetry)).resolves.toBe(
			"recovered",
		)
		expect(generate).toHaveBeenNthCalledWith(1, 1)
		expect(generate).toHaveBeenNthCalledWith(2, 2)
		expect(onRetry).toHaveBeenCalledOnce()
	})

	it("aborts and rejects a model generation at the local deadline", async () => {
		let observedSignal: AbortSignal | undefined
		const pending = (abortSignal: AbortSignal): Promise<string> => {
			observedSignal = abortSignal
			return new Promise(() => undefined)
		}

		await expect(generateAiWithDeadline(pending, 5)).rejects.toBeInstanceOf(
			AiGenerationTimeoutError,
		)
		expect(observedSignal?.aborted).toBe(true)
	})

	it("surfaces the final model error after exhausting retries", async () => {
		const finalError = new Error("still unavailable")
		const generate = vi
			.fn<(attempt: number) => Promise<string>>()
			.mockRejectedValueOnce(new Error("request timed out"))
			.mockRejectedValueOnce(finalError)

		await expect(retryAiGeneration(generate, 2)).rejects.toBe(finalError)
		expect(generate).toHaveBeenCalledTimes(2)
	})

	it("does not retry a generation error rejected by the retry policy", async () => {
		const timeout = new AiGenerationTimeoutError("request timed out")
		const generate = vi.fn<() => Promise<string>>().mockRejectedValue(timeout)
		const onRetry = vi.fn()

		await expect(
			retryAiGeneration(generate, 2, onRetry, (error) => error !== timeout),
		).rejects.toBe(timeout)
		expect(generate).toHaveBeenCalledOnce()
		expect(onRetry).not.toHaveBeenCalled()
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
		expect(facts).toContain("Choose one legal card value")
		expect(facts).not.toContain("card::")
		expect(facts).not.toContain("during passing")
		expect(JSON.stringify(strategy.outputSchema)).toContain("submitBid")
		expect(JSON.stringify(strategy.outputSchema)).not.toContain("passCards")
		expect(
			strategy.parseDecision({
				currentPlan: "Pass.",
				nextAction: { action: "passCards", cards: ["2C"] },
			}).ok,
		).toBe(false)
		expect(
			strategy.parseDecision({
				currentPlan: "Bid one.",
				nextAction: { action: "submitBid", bid: 1 },
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

	it("renders a compact strategic bidding prompt and uses the model", () => {
		const ace = card("ace-heart", "hearts", 14)
		const nine = card("nine-heart", "hearts", 9)
		const king = card("king-club", "clubs", 13)
		const three = card("three-diamond", "diamonds", 3)
		const context = ohHellBiddingContext([ace, nine, king, three], {})
		const facts = renderAiGameFacts(context)
		const strategy = aiGameStrategy("ohHell")

		expect(facts).toBe(`Oh Hell, round 2 of 5. 4 cards each. Trump is hearts.

You are P1, bidding 2nd of 3. P2 is the dealer and bids last. P0 leads the first trick.

Scores:
- P0: 10
- P1 (you): 12
- P2: 3

Bids so far:
- P0: 1
- P1 (you): pending
- P2: pending

Your hand: AH, 9H, KC, 3D.

Legal bids: 0, 1, 2, 3, 4.
Choose your bid.`)
		expect(facts).not.toContain("card::")
		expect(facts).not.toContain("Current trick")
		expect(facts).not.toContain("connected")
		expect(strategy.systemPrompt).toContain(
			"Making your bid scores 10 plus the number of tricks won.",
		)
		expect(strategy.systemPrompt).toContain(
			"Avoid counting the same source of strength twice.",
		)
		expect(strategy.usesTurnGenerator(context)).toBe(true)
	})

	it("explains the dealer's bid constraint using the supplied legal bids", () => {
		const context = ohHellBiddingContext(
			[
				card("queen-spade", "spades", 12),
				card("eight-spade", "spades", 8),
				card("ace-diamond", "diamonds", 14),
				card("seven-diamond", "diamonds", 7),
				card("four-club", "clubs", 4),
			],
			{ dealerId: aiPlayerId, legalBids: [0, 1, 3, 4, 5] },
		)
		const facts = renderAiGameFacts(context)

		expect(facts).toContain(
			"You are P1, bidding 3rd of 3. P1 is the dealer and bids last.",
		)
		expect(facts).toContain(
			"There are 5 tricks. As dealer, your bid may not make the table's total bids equal 5.",
		)
		expect(facts).toContain("Legal bids: 0, 1, 3, 4, 5.")
	})

	it("renders target-aware tactical meaning for every legal play", () => {
		const ace = card("ace-spade", "spades", 14)
		const nine = card("nine-spade", "spades", 9)
		const king = card("king-club", "clubs", 13)
		const facts = renderAiGameFacts(ohHellPlayingContext([ace, nine, king]))

		expect(facts).toBe(`Oh Hell, round 2 of 5, trick 2 of 4. Trump is spades.
You are P1, playing 2nd of 3. 3 tricks remain, including this one.

Targets:
- P0: bid 1, won 1 — on target; needs 0 more. 3 cards.
- P1 (you): bid 1, won 0 — needs exactly 1. 3 cards.
- P2: bid 2, won 0 — needs exactly 2. 3 cards.

Scores: P0 10, P1 12, P2 3.

Current trick:
P0 led QS. P0 is currently winning with QS. P2 plays after you.

Your hand: AS, 9S, KC.
Legal plays:
- AS (overtrumps QS; unbeatable; would reach your bid exactly)
- 9S (ducks QS; cannot win)

Completed play:
1. P0 AD, P1 3D, P2 7D. P0 won.

Current plan:
Bid 1. Preserve AS for a reliable trump trick; after reaching the bid, shed KC and avoid taking extras.

Choose one legal card value.`)
		expect(facts).not.toContain("card::")
		expect(facts).not.toContain("connected")
		expect(facts).not.toContain("Private pass")
	})

	it("labels ruffs and exposes voids learned from public play", () => {
		const lowHeart = card("low-heart", "hearts", 2)
		const trump = card("ten-spade", "spades", 10)
		const context = ohHellPlayingContext([lowHeart, trump])
		context.privateView.playableCardIds = [lowHeart.id, trump.id]
		context.publicView.currentTrick = [
			{ card: card("king-club-led", "clubs", 13), playerId: humanPlayerId },
		]
		context.publicView.completedTricks = [
			{
				leftoverAward: null,
				plays: [
					{
						card: card("eight-club-played", "clubs", 8),
						playerId: humanPlayerId,
					},
					{
						card: card("three-club-played", "clubs", 3),
						playerId: aiPlayerId,
					},
					{
						card: card("four-heart-played", "hearts", 4),
						playerId: opponentPlayerId,
					},
				],
				winnerId: humanPlayerId,
			},
		]

		const facts = renderAiGameFacts(context)

		expect(facts).toContain(
			"TS (ruffs KC; currently winning; 1 player remains)",
		)
		expect(facts).toContain("2H (discards; cannot win)")
		expect(facts).toContain("P2 is void in clubs.")
	})
})
