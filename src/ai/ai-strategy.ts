import { ArkErrors } from "arktype"

import type { CardId, VisibleCard } from "../game/hearts-types.ts"
import type { AiGameContext } from "./ai-game-facts.ts"
import {
	aiTurnDecisionType,
	type AiNextAction,
	type AiTurnDecision,
} from "./ai-types.ts"

export type AiTurnGenerator = (
	context: AiGameContext,
) => Promise<AiTurnDecision>

export type AiFallbackReason =
	| "generation_error"
	| "illegal_action"
	| "invalid_schema"

export type AiGuardObserver = {
	onFallback?: (details: {
		context: AiGameContext
		error?: unknown
		generated?: unknown
		reason: AiFallbackReason
	}) => void
}

function pointRisk(card: VisibleCard): number {
	if (card.suit === "spades" && card.rank === 12) return 100
	if (card.suit === "hearts") return 40 + card.rank
	if (card.suit === "spades" && card.rank > 12) return 25 + card.rank
	return card.rank
}

function cardsByIds(
	context: AiGameContext,
	cardIds: readonly CardId[],
): VisibleCard[] {
	const ids = new Set(cardIds)
	return context.privateView.cards.filter((card) => ids.has(card.id))
}

function choosePass(context: AiGameContext): AiNextAction {
	const cards = [...context.privateView.cards]
		.sort((left, right) => pointRisk(right) - pointRisk(left))
		.slice(0, 3)
	if (cards.length !== 3) {
		throw new Error("The AI needs exactly three cards before it can pass.")
	}
	return { action: "passCards", cardIds: cards.map((card) => card.id) }
}

function choosePlay(context: AiGameContext): AiNextAction {
	const legalCards = cardsByIds(context, context.privateView.playableCardIds)
	if (legalCards.length === 0) {
		throw new Error("The AI has no legal card to play.")
	}

	const leadPlay = context.publicView.currentTrick[0]
	let selected: VisibleCard
	if (leadPlay === undefined) {
		selected = [...legalCards].sort(
			(left, right) => pointRisk(left) - pointRisk(right),
		)[0] as VisibleCard
	} else {
		const leadSuit = leadPlay.card.suit
		const currentWinningRank = Math.max(
			...context.publicView.currentTrick
				.filter((play) => play.card.suit === leadSuit)
				.map((play) => play.card.rank),
		)
		const followingSuit = legalCards.every((card) => card.suit === leadSuit)
		if (followingSuit) {
			const safeCards = legalCards
				.filter((card) => card.rank < currentWinningRank)
				.sort((left, right) => right.rank - left.rank)
			selected =
				safeCards[0] ??
				([...legalCards].sort(
					(left, right) => left.rank - right.rank,
				)[0] as VisibleCard)
		} else {
			selected = [...legalCards].sort(
				(left, right) => pointRisk(right) - pointRisk(left),
			)[0] as VisibleCard
		}
	}
	return { action: "playCard", cardId: selected.id }
}

export function chooseFallbackAiAction(context: AiGameContext): AiNextAction {
	if (context.publicView.phase === "passing") return choosePass(context)
	return choosePlay(context)
}

function isLegalGeneratedAction(
	context: AiGameContext,
	action: AiNextAction,
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

export function fallbackAiDecision(context: AiGameContext): AiTurnDecision {
	const nextAction = chooseFallbackAiAction(context)
	return {
		currentPlan:
			nextAction.action === "passCards"
				? "Reduce immediate point-card risk while preserving flexible low cards."
				: "Avoid taking point-heavy tricks when possible and discard dangerous cards when void.",
		nextAction,
		observation:
			context.publicView.currentTrick.length === 0
				? "A new trick is ready."
				: `${context.publicView.currentTrick.length} card(s) are visible in the current trick.`,
	}
}

export function createGuardedAiTurnGenerator(
	generate: AiTurnGenerator,
	observer: AiGuardObserver = {},
): AiTurnGenerator {
	return async (context) => {
		let generated: AiTurnDecision
		try {
			generated = await generate(context)
		} catch (error) {
			observer.onFallback?.({
				context,
				error,
				reason: "generation_error",
			})
			return fallbackAiDecision(context)
		}
		const validated = aiTurnDecisionType(generated)
		if (validated instanceof ArkErrors) {
			observer.onFallback?.({
				context,
				error: validated,
				generated,
				reason: "invalid_schema",
			})
			return fallbackAiDecision(context)
		}
		if (
			!isLegalGeneratedAction(context, validated.nextAction as AiNextAction)
		) {
			observer.onFallback?.({
				context,
				generated,
				reason: "illegal_action",
			})
			return fallbackAiDecision(context)
		}
		return {
			currentPlan: validated.currentPlan,
			nextAction: validated.nextAction as AiNextAction,
			observation: validated.observation,
		}
	}
}
