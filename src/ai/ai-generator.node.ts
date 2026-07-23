import { createOpenAI } from "@ai-sdk/openai"
import { generateText, jsonSchema, Output } from "ai"
import type { CacheMode } from "varmint"
import { Squirrel } from "varmint"

import { serverLogger } from "../observability/span-logger.node.ts"
import { renderAiGameFacts } from "./ai-game-facts.ts"
import type { AiModelId } from "./ai-models.ts"
import {
	createGuardedAiTurnGenerator,
	fallbackAiDecision,
	type AiTurnGenerator,
} from "./ai-strategy.ts"
import { aiTurnDecisionJsonSchema, type AiTurnDecision } from "./ai-types.ts"

function cacheMode(): CacheMode {
	const configured = process.env.VARMINT_CACHE_MODE
	if (
		configured === "read" ||
		configured === "write" ||
		configured === "read-write"
	) {
		return configured
	}
	return "off"
}

export const aiGeneratorSquirrel = new Squirrel(
	cacheMode(),
	".varmint/hearts-ai",
)

export function wrapAiGeneratorWithVarmint(
	key: string,
	generate: AiTurnGenerator,
	squirrel: Squirrel = aiGeneratorSquirrel,
): AiTurnGenerator {
	const wrapped = squirrel.add(key, generate)
	return async (context) =>
		wrapped
			.for(
				JSON.stringify({
					observations: context.observations,
					playerId: context.playerId,
					previousPlan: context.previousPlan,
					privateView: context.privateView,
					publicView: context.publicView,
				}),
			)
			.get(context)
}

const systemPrompt = [
	"You are a strategic Hearts player seated at a private multiplayer table.",
	"Choose exactly one legal next action from the opaque card IDs in the supplied facts.",
	"Success means: obey the current phase, follow suit, minimize expected points, track exposed cards, and return a concise observation and reusable plan.",
	"Never infer or claim values for hidden opponent cards. Opponent hand counts are known; opponent card values are not.",
	"For passing, return exactly three different card IDs from your private hand.",
	"For play, return exactly one ID from Legal opaque card IDs.",
].join("\n")

export function createOpenAiTurnGenerator(
	modelId: AiModelId,
	apiKey = process.env.OPENAI_API_KEY,
): AiTurnGenerator {
	if (apiKey === undefined || apiKey.length === 0) {
		serverLogger.warn("ai.generator.fallback_configured", {
			modelId,
			reason: "missing_openai_api_key",
		})
		return async (context) =>
			serverLogger.withSpan(
				"ai.strategy",
				{
					context,
					modelId,
					provider: "deterministic_fallback",
				},
				(span) => {
					const decision = fallbackAiDecision(context)
					span.event("ai.decision", { decision })
					return decision
				},
			)
	}

	const openai = createOpenAI({ apiKey })
	const model = openai.responses(modelId)
	const generate: AiTurnGenerator = async (context): Promise<AiTurnDecision> =>
		serverLogger.withSpan(
			"ai.openai.generate",
			{
				modelId,
				phase: context.publicView.phase,
				playerId: context.playerId,
				roomCode: context.publicView.roomCode,
				roundNumber: context.publicView.roundNumber,
				trickNumber: context.publicView.trickNumber,
			},
			async (span) => {
				const renderedFacts = renderAiGameFacts(context)
				span.event("ai.prompt.rendered", {
					renderedFacts,
					systemPrompt,
				})
				const result = await generateText({
					model,
					output: Output.object({
						description:
							"A legal Hearts action plus a private observation and strategic plan.",
						name: "hearts_turn_decision",
						schema: jsonSchema<AiTurnDecision>(aiTurnDecisionJsonSchema),
					}),
					prompt: renderedFacts,
					providerOptions: {
						openai: {
							reasoningEffort: "low",
							textVerbosity: "low",
						},
					},
					system: systemPrompt,
				})
				span.event("ai.openai.response", {
					finishReason: result.finishReason,
					output: result.output,
					providerMetadata: result.providerMetadata,
					response: {
						id: result.response.id,
						modelId: result.response.modelId,
						timestamp: result.response.timestamp,
					},
					usage: result.usage,
				})
				return result.output
			},
		)

	const guarded = createGuardedAiTurnGenerator(
		wrapAiGeneratorWithVarmint(`hearts-${modelId}`, generate),
		{
			onFallback: (details) => {
				serverLogger.warn("ai.strategy.fallback", {
					...details,
					modelId,
				})
			},
		},
	)

	return async (context) =>
		serverLogger.withSpan(
			"ai.strategy",
			{
				cacheMode: aiGeneratorSquirrel.mode,
				modelId,
				phase: context.publicView.phase,
				playerId: context.playerId,
				roomCode: context.publicView.roomCode,
				roundNumber: context.publicView.roundNumber,
				trickNumber: context.publicView.trickNumber,
			},
			async (span) => {
				const decision = await guarded(context)
				span.event("ai.decision", {
					decision,
				})
				return decision
			},
		)
}
