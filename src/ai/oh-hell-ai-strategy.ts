import { ArkErrors, type } from "arktype"
import type { JSONSchema7 } from "ai"

import { cardIdType } from "../game/game-actions.ts"
import type { VisibleCard } from "../game/game-types.ts"
import type { AiGameStrategy } from "./ai-game-strategy.ts"
import type { AiGameContextFor } from "./ai-game-facts.ts"
import type { AiTurnDecisionFor, OhHellAiNextAction } from "./ai-types.ts"

const ohHellAiTurnDecisionType = type({
	currentPlan: "string",
	nextAction: type({
		action: "'playCard'",
		cardId: cardIdType,
	}).or({
		action: "'submitBid'",
		bid: "number.integer >= 0",
	}),
	observation: "string",
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
						cardId: { pattern: "^card::", type: "string" },
					},
					required: ["action", "cardId"],
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
		observation: { type: "string" },
	},
	required: ["currentPlan", "nextAction", "observation"],
	type: "object",
}

function fallbackObservation(context: AiGameContextFor<"ohHell">): string {
	return context.publicView.currentTrick.length === 0
		? "A new trick is ready."
		: `${context.publicView.currentTrick.length} card(s) are visible in the current trick.`
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
	return { action: "playCard", cardId: selected.id }
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
		observation: fallbackObservation(context),
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
	return (
		context.publicView.phase === "playing" &&
		context.privateView.playableCardIds.includes(action.cardId)
	)
}

const commonPrompt = [
	"Choose exactly one legal next action using an opaque card ID from the supplied hand.",
	"Compact cards use rank then suit: T/J/Q/K/A and C/D/H/S. Completed tricks encode Tn>winner followed by plays in order.",
	"Card values uniquely identify deck cards, so history omits opaque IDs without losing strategic identity.",
	"Never infer or claim values for hidden opponent cards. Opponent hand counts are known; opponent card values are not.",
	"For play, copy exactly the card:: ID inside brackets on a hand row labeled LEGAL; do not include brackets or the label.",
	"Keep observation and plan terse; refer to cards by compact code and never repeat opaque IDs outside nextAction.",
]

export const ohHellAiStrategy: AiGameStrategy<"ohHell"> = {
	fallbackDecision: fallbackOhHellDecision,
	isLegalAction: isLegalOhHellAction,
	outputDescription:
		"A legal Oh Hell action plus a private observation and strategic plan.",
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
	submitAction: (socket, action) => {
		switch (action.action) {
			case "playCard":
				return new Promise((resolve) => {
					socket.emit("playCard", action.cardId, resolve)
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
		"Success means: bid and win exactly the predicted number of tricks, obey turn order and follow-suit rules, account for trump, and return a concise observation and reusable plan.",
		"For bidding, return one number listed among the legal bids.",
		...commonPrompt,
	].join("\n"),
	usesTurnGenerator: (context) => context.publicView.phase !== "bidding",
}
