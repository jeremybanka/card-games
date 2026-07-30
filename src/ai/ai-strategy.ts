import type { AiGameContext, AiGameContextFor } from "./ai-game-facts.ts"
import { aiGameStrategy } from "./ai-game-strategy.ts"
import type {
	AiGameKind,
	AiNextActionFor,
	AiTurnDecision,
	AiTurnDecisionFor,
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

export function fallbackAiDecision<Kind extends AiGameKind>(
	context: AiGameContextFor<Kind>,
): AiTurnDecisionFor<Kind> {
	return aiGameStrategy<Kind>(context.publicView.gameKind).fallbackDecision(context)
}

export function chooseFallbackAiAction<Kind extends AiGameKind>(
	context: AiGameContextFor<Kind>,
): AiNextActionFor<Kind> {
	return fallbackAiDecision(context).nextAction
}

export function createGuardedAiTurnGenerator(
	generate: AiTurnGenerator,
	observer: AiGuardObserver = {},
): AiTurnGenerator {
	return async (context) => {
		const strategy = aiGameStrategy(context.publicView.gameKind)
		let generated: AiTurnDecision
		try {
			generated = await generate(context)
		} catch (error) {
			observer.onFallback?.({
				context,
				error,
				reason: "generation_error",
			})
			return strategy.fallbackDecision(context)
		}
		const parsed = strategy.parseDecision(generated)
		if (!parsed.ok) {
			observer.onFallback?.({
				context,
				error: parsed.error,
				generated,
				reason: "invalid_schema",
			})
			return strategy.fallbackDecision(context)
		}
		if (!strategy.isLegalAction(context, parsed.value.nextAction)) {
			observer.onFallback?.({
				context,
				generated,
				reason: "illegal_action",
			})
			return strategy.fallbackDecision(context)
		}
		return parsed.value
	}
}
