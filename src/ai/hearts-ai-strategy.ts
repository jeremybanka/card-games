import { ArkErrors, type } from "arktype"
import type { JSONSchema7 } from "ai"

import { cardIdType } from "../game/game-actions.ts"
import { passCardIdsType } from "../game/hearts-actions.ts"
import { chooseHeartsAutoPlayCard } from "../game/hearts-auto-play.ts"
import { heartsPointRisk } from "../game/hearts-card-strategy.ts"
import type { AiGameStrategy } from "./ai-game-strategy.ts"
import type { AiGameContextFor } from "./ai-game-facts.ts"
import type { AiTurnDecisionFor, HeartsAiNextAction } from "./ai-types.ts"

const heartsAiTurnDecisionType = type({
	currentPlan: "string",
	nextAction: type({
		action: "'passCards'",
		cardIds: passCardIdsType,
	}).or({
		action: "'playCard'",
		cardId: cardIdType,
	}),
	observation: "string",
})

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
						cardIds: {
							items: { pattern: "^card::", type: "string" },
							maxItems: 3,
							minItems: 3,
							type: "array",
						},
					},
					required: ["action", "cardIds"],
					type: "object",
				},
				{
					additionalProperties: false,
					properties: {
						action: { enum: ["playCard"], type: "string" },
						cardId: { pattern: "^card::", type: "string" },
					},
					required: ["action", "cardId"],
					type: "object",
				},
			],
		},
		observation: { type: "string" },
	},
	required: ["currentPlan", "nextAction", "observation"],
	type: "object",
}

function fallbackObservation(context: AiGameContextFor<"hearts">): string {
	return context.publicView.currentTrick.length === 0
		? "A new trick is ready."
		: `${context.publicView.currentTrick.length} card(s) are visible in the current trick.`
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
	return { action: "passCards", cardIds: cards.map((card) => card.id) }
}

function chooseHeartsPlay(
	context: AiGameContextFor<"hearts">,
): HeartsAiNextAction {
	return {
		action: "playCard",
		cardId: chooseHeartsAutoPlayCard(
			context.privateView.cards,
			context.privateView.playableCardIds,
			context.publicView.currentTrick,
		),
	}
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
		observation: fallbackObservation(context),
	}
}

function isLegalHeartsAction(
	context: AiGameContextFor<"hearts">,
	action: HeartsAiNextAction,
): boolean {
	if (action.action === "passCards") {
		if (context.publicView.phase !== "passing") return false
		if (action.cardIds.length !== 3) return false
		if (new Set(action.cardIds).size !== 3) return false
		const handIds = new Set(context.privateView.cards.map((card) => card.id))
		return action.cardIds.every((cardId) => handIds.has(cardId))
	}
	return (
		context.publicView.phase === "playing" &&
		context.privateView.playableCardIds.includes(action.cardId)
	)
}

export const heartsAiStrategy: AiGameStrategy<"hearts"> = {
	fallbackDecision: fallbackHeartsDecision,
	isLegalAction: isLegalHeartsAction,
	outputDescription:
		"A legal Hearts action plus a private observation and strategic plan.",
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
	submitAction: (socket, action) => {
		switch (action.action) {
			case "passCards":
				return new Promise((resolve) => {
					socket.emit("passCards", action.cardIds, resolve)
				})
			case "playCard":
				return new Promise((resolve) => {
					socket.emit("playCard", action.cardId, resolve)
				})
		}
		throw new Error("Hearts cannot submit that AI action.")
	},
	systemPrompt: [
		"You are a strategic Hearts player seated at a private multiplayer table.",
		"Choose exactly one legal next action using an opaque card ID from the supplied hand.",
		"Success means: obey the current phase, follow suit, minimize expected points, track exposed cards, and return a concise observation and reusable plan.",
		"Compact cards use rank then suit: T/J/Q/K/A and C/D/H/S. Completed tricks encode Tn>winner followed by plays in order.",
		"Use private pass memory and completed tricks as exact memory. Cards you passed remain known to be with their recipient until publicly played.",
		"Card values uniquely identify deck cards, so history omits opaque IDs without losing strategic identity.",
		"Never infer or claim values for hidden opponent cards. Opponent hand counts are known; opponent card values are not.",
		"For passing, return exactly three different card IDs from your private hand.",
		"For play, copy exactly the card:: ID inside brackets on a hand row labeled LEGAL; do not include brackets or the label.",
		"Keep observation and plan terse; refer to cards by compact code and never repeat opaque IDs outside nextAction.",
	].join("\n"),
}
