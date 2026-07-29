import { ArkErrors, type } from "arktype"
import type { JSONSchema7 } from "ai"

import type { VisibleCard } from "../game/game-types.ts"
import { aiCardValue, cardIdForAiValue } from "./ai-card-value.ts"
import type { AiGameStrategy } from "./ai-game-strategy.ts"
import type { AiGameContextFor } from "./ai-game-facts.ts"
import type { AiTurnDecisionFor, OhHellAiNextAction } from "./ai-types.ts"

const ohHellAiTurnDecisionType = type({
	currentPlan: "string",
	nextAction: type({
		action: "'playCard'",
		card: "string",
	}).or({
		action: "'submitBid'",
		bid: "number.integer >= 0",
	}),
})

const ohHellAiTurnDecisionJsonSchema: JSONSchema7 = {
	additionalProperties: false,
	properties: {
		currentPlan: { type: "string" },
		nextAction: {
			anyOf: [
				{
					additionalProperties: false,
					properties: {
						action: { enum: ["playCard"], type: "string" },
						card: { pattern: "^(?:[2-9TJQKA])[CDHS]$", type: "string" },
					},
					required: ["action", "card"],
					type: "object",
				},
				{
					additionalProperties: false,
					properties: {
						action: { enum: ["submitBid"], type: "string" },
						bid: { minimum: 0, type: "integer" },
					},
					required: ["action", "bid"],
					type: "object",
				},
			],
		},
	},
	required: ["currentPlan", "nextAction"],
	type: "object",
}

function chooseOhHellBid(
	context: AiGameContextFor<"ohHell">,
): OhHellAiNextAction {
	const bid =
		context.privateView.legalBids.find((candidate) => candidate === 1) ??
		context.privateView.legalBids[0]
	if (bid === undefined) throw new Error("The AI has no legal bid.")
	return { action: "submitBid", bid }
}

function chooseOhHellPlay(
	context: AiGameContextFor<"ohHell">,
): OhHellAiNextAction {
	const legalCards = context.privateView.cards.filter((card) =>
		context.privateView.playableCardIds.includes(card.id),
	)
	if (legalCards.length === 0) throw new Error("The AI has no legal card.")
	const me = context.publicView.players.find(
		(player) => player.id === context.playerId,
	)
	const needsTrick = (me?.tricksWon ?? 0) < (me?.bid ?? 0)
	const cardStrength = (card: VisibleCard): number => {
		const trumpBonus = card.suit === context.publicView.trumpSuit ? 100 : 0
		return trumpBonus + card.rank
	}
	const selected = [...legalCards].sort((left, right) =>
		needsTrick
			? cardStrength(right) - cardStrength(left)
			: cardStrength(left) - cardStrength(right),
	)[0]
	if (selected === undefined) throw new Error("The AI has no legal card.")
	return { action: "playCard", card: aiCardValue(selected) }
}

function fallbackOhHellDecision(
	context: AiGameContextFor<"ohHell">,
): AiTurnDecisionFor<"ohHell"> {
	const nextAction =
		context.publicView.phase === "bidding"
			? chooseOhHellBid(context)
			: chooseOhHellPlay(context)
	return {
		currentPlan:
			nextAction.action === "submitBid"
				? "Make a conservative legal bid from the strength visible in this hand."
				: "Target the exact bid: take tricks still needed, then shed strength and avoid extra tricks.",
		nextAction,
	}
}

function isLegalOhHellAction(
	context: AiGameContextFor<"ohHell">,
	action: OhHellAiNextAction,
): boolean {
	if (action.action === "submitBid") {
		return (
			context.publicView.phase === "bidding" &&
			context.privateView.legalBids.includes(action.bid)
		)
	}
	const selected = context.privateView.cards.find(
		(card) => aiCardValue(card) === action.card,
	)
	return (
		context.publicView.phase === "playing" &&
		selected !== undefined &&
		context.privateView.playableCardIds.includes(selected.id)
	)
}

const commonPrompt = [
	"Choose exactly one legal next action using a literal card value from the supplied hand.",
	"Compact cards use rank then suit: T/J/Q/K/A and C/D/H/S. Completed tricks encode Tn>winner followed by plays in order.",
	"Never infer or claim values for hidden opponent cards. Opponent hand counts are known; opponent card values are not.",
	"For play, return exactly one listed legal card value.",
	"Keep the plan terse.",
]

export const ohHellAiStrategy: AiGameStrategy<"ohHell"> = {
	fallbackDecision: fallbackOhHellDecision,
	isLegalAction: isLegalOhHellAction,
	outputDescription: "A legal Oh Hell action plus a reusable strategic plan.",
	outputName: "oh_hell_turn_decision",
	outputSchema: ohHellAiTurnDecisionJsonSchema,
	parseDecision: (input) => {
		const result = ohHellAiTurnDecisionType(input)
		return result instanceof ArkErrors
			? { error: result, ok: false }
			: {
					ok: true,
					value: result as AiTurnDecisionFor<"ohHell">,
				}
	},
	privateViewForStrategy: (view) => view,
	submitAction: (socket, action, privateView) => {
		switch (action.action) {
			case "playCard":
				return new Promise((resolve) => {
					socket.emit(
						"playCard",
						cardIdForAiValue(privateView.cards, action.card),
						resolve,
					)
				})
			case "submitBid":
				return new Promise((resolve) => {
					socket.emit("submitBid", action.bid, resolve)
				})
		}
		throw new Error("Oh Hell cannot submit that AI action.")
	},
	systemPrompt: [
		"You are a strategic Oh Hell player seated at a private multiplayer table.",
		"Success means: bid and win exactly the predicted number of tricks, obey turn order and follow-suit rules, account for trump, and return a concise reusable plan.",
		"For bidding, return one number listed among the legal bids.",
		...commonPrompt,
	].join("\n"),
	usesTurnGenerator: (context) => context.publicView.phase !== "bidding",
}
