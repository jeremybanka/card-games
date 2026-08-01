import { ArkErrors, type } from "arktype"
import type { JSONSchema7 } from "ai"

import { chooseHeartsAutoPlayCard } from "../game/hearts-auto-play.ts"
import { heartsPointRisk } from "../game/hearts-card-strategy.ts"
import { aiCardValue, cardIdForAiValue } from "./ai-card-value.ts"
import type { AiGameStrategy } from "./ai-game-strategy.ts"
import type { AiGameContextFor } from "./ai-game-facts.ts"
import type { AiTurnDecisionFor, HeartsAiNextAction } from "./ai-types.ts"

const heartsAiTurnDecisionType = type({
	currentPlan: "string",
	nextAction: type({
		action: "'passCards'",
		cards: "string[]",
	}).or({
		action: "'playCard'",
		card: "string",
	}),
})

const cardValuePattern = "^(?:[2-9TJQKA])[CDHS]$"

const heartsAiTurnDecisionJsonSchema: JSONSchema7 = {
	additionalProperties: false,
	properties: {
		currentPlan: { type: "string" },
		nextAction: {
			anyOf: [
				{
					additionalProperties: false,
					properties: {
						action: { enum: ["passCards"], type: "string" },
						cards: {
							items: { pattern: cardValuePattern, type: "string" },
							maxItems: 3,
							minItems: 3,
							type: "array",
						},
					},
					required: ["action", "cards"],
					type: "object",
				},
				{
					additionalProperties: false,
					properties: {
						action: { enum: ["playCard"], type: "string" },
						card: { pattern: cardValuePattern, type: "string" },
					},
					required: ["action", "card"],
					type: "object",
				},
			],
		},
	},
	required: ["currentPlan", "nextAction"],
	type: "object",
}

function chooseHeartsPass(
	context: AiGameContextFor<"hearts">,
): HeartsAiNextAction {
	const cards = [...context.privateView.cards]
		.sort((left, right) => heartsPointRisk(right) - heartsPointRisk(left))
		.slice(0, 3)
	if (cards.length !== 3) {
		throw new Error("The AI needs exactly three cards before it can pass.")
	}
	return { action: "passCards", cards: cards.map(aiCardValue) }
}

function chooseHeartsPlay(
	context: AiGameContextFor<"hearts">,
): HeartsAiNextAction {
	const cardId = chooseHeartsAutoPlayCard(
		context.privateView.cards,
		context.privateView.playableCardIds,
		context.publicView.currentTrick,
	)
	const card = context.privateView.cards.find(
		(candidate) => candidate.id === cardId,
	)
	if (card === undefined)
		throw new Error("The AI fallback selected a missing card.")
	return { action: "playCard", card: aiCardValue(card) }
}

function fallbackHeartsDecision(
	context: AiGameContextFor<"hearts">,
): AiTurnDecisionFor<"hearts"> {
	const nextAction =
		context.publicView.phase === "passing"
			? chooseHeartsPass(context)
			: chooseHeartsPlay(context)
	return {
		currentPlan:
			nextAction.action === "passCards"
				? "Reduce immediate point-card risk while preserving flexible low cards."
				: "Avoid taking point-heavy tricks when possible and discard dangerous cards when void.",
		nextAction,
	}
}

function isLegalHeartsAction(
	context: AiGameContextFor<"hearts">,
	action: HeartsAiNextAction,
): boolean {
	if (action.action === "passCards") {
		if (context.publicView.phase !== "passing") return false
		if (action.cards.length !== 3) return false
		if (new Set(action.cards).size !== 3) return false
		const handValues = new Set(context.privateView.cards.map(aiCardValue))
		return action.cards.every((card) => handValues.has(card))
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

export const heartsAiStrategy: AiGameStrategy<"hearts"> = {
	fallbackDecision: fallbackHeartsDecision,
	isLegalAction: isLegalHeartsAction,
	outputDescription: "A legal Hearts action plus a reusable strategic plan.",
	outputName: "hearts_turn_decision",
	outputSchema: heartsAiTurnDecisionJsonSchema,
	parseDecision: (input) => {
		const result = heartsAiTurnDecisionType(input)
		return result instanceof ArkErrors
			? { error: result, ok: false }
			: {
					ok: true,
					value: result as AiTurnDecisionFor<"hearts">,
				}
	},
	privateViewForStrategy: (view) => {
		const strategicView = { ...view }
		Reflect.deleteProperty(strategicView, "passReceipt")
		return strategicView
	},
	submitAction: (socket, action, context) => {
		switch (action.action) {
			case "passCards":
				return new Promise((resolve) => {
					socket.emit(
						"passCards",
						action.cards.map((card) =>
							cardIdForAiValue(context.privateView.cards, card),
						),
						resolve,
					)
				})
			case "playCard":
				return new Promise((resolve) => {
					socket.emit(
						"playCard",
						cardIdForAiValue(context.privateView.cards, action.card),
						resolve,
					)
				})
		}
		throw new Error("Hearts cannot submit that AI action.")
	},
	systemPrompt: [
		"You are a strategic Hearts player seated at a private multiplayer table.",
		"Choose exactly one legal next action using a literal card value from the supplied hand.",
		"Success means: obey the current phase, follow suit, minimize expected points, track exposed cards, and return a concise reusable plan.",
		"Cards use rank then suit: T/J/Q/K/A and C/D/H/S.",
		"Treat each parenthesized legal-play label as authoritative tactical fact.",
		"Use private pass memory and completed tricks as exact memory. Cards you passed remain known to be with their recipient until publicly played.",
		"Never infer or claim values for hidden opponent cards. Opponent hand counts are known; opponent card values are not.",
		"For passing, return exactly three different card values from your private hand.",
		"For play, return exactly one listed legal card value.",
		"Keep the plan terse.",
	].join("\n"),
	usesTurnGenerator: () => true,
}
