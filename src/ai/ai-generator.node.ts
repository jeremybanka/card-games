import { createOpenAI } from "@ai-sdk/openai"
import { generateText, jsonSchema, Output } from "ai"
import type { CacheMode } from "varmint"
import { Squirrel } from "varmint"

import { serverLogger } from "../observability/span-logger.node.ts"
import { renderAiGameFacts, type AiGameContext } from "./ai-game-facts.ts"
import { aiGameStrategy } from "./ai-game-strategy.ts"
import { legacyCompatibleCacheViews } from "./legacy-hearts-cache.ts"
import type { AiModelId } from "./ai-models.ts"
import {
	createGuardedAiTurnGenerator,
	fallbackAiDecision,
	type AiGuardObserver,
	type AiTurnGenerator,
} from "./ai-strategy.ts"
import type { AiTurnDecision } from "./ai-types.ts"

export type AiModelResponseRecord = {
	finishReason: string
	modelId: AiModelId
	output: AiTurnDecision
	providerMetadata: unknown
	response: {
		id: string
		modelId: string
		timestamp: string
	}
	usage: unknown
}

export type OpenAiTurnGeneratorOptions = {
	onFallback?: NonNullable<AiGuardObserver["onFallback"]>
	onModelResponse?: (record: AiModelResponseRecord) => void
	squirrel?: Squirrel
}

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
	process.env.VARMINT_CACHE_DIRECTORY?.trim() || ".varmint/hearts-ai",
)

export function wrapAiGeneratorWithVarmint(
	key: string,
	generate: AiTurnGenerator,
	squirrel: Squirrel = aiGeneratorSquirrel,
): AiTurnGenerator {
	const sourceContexts = new WeakMap<object, AiGameContext>()
	const wrapped = squirrel.add(
		key,
		async (cacheableContext: AiGameContext): Promise<AiTurnDecision> => {
			const sourceContext = sourceContexts.get(cacheableContext)
			if (sourceContext === undefined) {
				throw new Error("The AI cache input lost its source game context.")
			}
			return generate(sourceContext)
		},
	)
	return async (context) => {
		const {
			privateView: cacheablePrivateView,
			publicView: cacheablePublicView,
		} = legacyCompatibleCacheViews(context)
		const cacheableContext = {
			...context,
			privateView: cacheablePrivateView,
			publicView: cacheablePublicView,
		} as AiGameContext
		sourceContexts.set(cacheableContext, context)
		try {
			return await wrapped
				.for(
					JSON.stringify({
						memoryLedger: context.memoryLedger,
						observations: context.observations,
						playerId: context.playerId,
						previousPlan: context.previousPlan,
						privateView: cacheablePrivateView,
						publicView: cacheablePublicView,
					}),
				)
				.get(cacheableContext)
		} finally {
			sourceContexts.delete(cacheableContext)
		}
	}
}

export function createOpenAiTurnGenerator(
	modelId: AiModelId,
	apiKey = process.env.OPENAI_API_KEY,
	options: OpenAiTurnGeneratorOptions = {},
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
				const gameKind = context.publicView.gameKind
				const renderedFacts = renderAiGameFacts(context)
				const strategy = aiGameStrategy(gameKind)
				const systemPrompt = strategy.systemPrompt
				span.event("ai.prompt.rendered", {
					renderedFacts,
					systemPrompt,
				})
				const result = await generateText({
					model,
					output: Output.object({
						description: strategy.outputDescription,
						name: strategy.outputName,
						schema: jsonSchema<AiTurnDecision>(strategy.outputSchema),
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
				options.onModelResponse?.({
					finishReason: result.finishReason,
					modelId,
					output: result.output,
					providerMetadata: result.providerMetadata,
					response: {
						id: result.response.id,
						modelId: result.response.modelId,
						timestamp: result.response.timestamp.toISOString(),
					},
					usage: result.usage,
				})
				return result.output
			},
		)

	const guarded = createGuardedAiTurnGenerator(
		wrapAiGeneratorWithVarmint(
			`hearts-compact-v2-${modelId}`,
			generate,
			options.squirrel,
		),
		{
			onFallback: (details) => {
				serverLogger.warn("ai.strategy.fallback", {
					...details,
					modelId,
				})
				options.onFallback?.(details)
			},
		},
	)

	return async (context) =>
		serverLogger.withSpan(
			"ai.strategy",
			{
				cacheMode: options.squirrel?.mode ?? aiGeneratorSquirrel.mode,
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
