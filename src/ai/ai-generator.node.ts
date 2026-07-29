import { createOpenAI } from "@ai-sdk/openai"
import { generateText, jsonSchema, Output } from "ai"
import type { CacheMode } from "varmint"
import { Squirrel } from "varmint"

import { serverLogger } from "../observability/span-logger.node.ts"
import { renderAiGameFacts, type AiGameContext } from "./ai-game-facts.ts"
import { aiGameStrategy } from "./ai-game-strategy.ts"
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

export function promptFixtureKey(context: AiGameContext): string {
	const playerIndex = context.publicView.players.findIndex(
		(player) => player.id === context.playerId,
	)
	const player = playerIndex === -1 ? context.playerId : `P${playerIndex}`
	return context.publicView.phase === "playing"
		? `round-${context.publicView.roundNumber}-trick-${
				context.publicView.trickNumber + 1
			}-play-${context.publicView.currentTrick.length + 1}-${player}`
		: `round-${context.publicView.roundNumber}-${context.publicView.phase}-${player}`
}

export function wrapAiGeneratorWithVarmint(
	key: string,
	generate: AiTurnGenerator,
	squirrel: Squirrel = aiGeneratorSquirrel,
): AiTurnGenerator {
	const sourceContexts = new Map<string, AiGameContext>()
	const wrapped = squirrel.add(
		key,
		async (prompt: string): Promise<AiTurnDecision> => {
			const sourceContext = sourceContexts.get(prompt)
			if (sourceContext === undefined) {
				throw new Error("The AI cache input lost its source game context.")
			}
			return generate(sourceContext)
		},
	)
	return async (context) => {
		const prompt = renderAiGameFacts(context)
		sourceContexts.set(prompt, context)
		try {
			return await wrapped.for(promptFixtureKey(context)).get(prompt)
		} finally {
			sourceContexts.delete(prompt)
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
				const prompt = renderAiGameFacts(context)
				const strategy = aiGameStrategy(gameKind)
				const systemPrompt = strategy.systemPrompt
				span.event("ai.prompt.rendered", {
					prompt,
					systemPrompt,
				})
				const result = await generateText({
					model,
					output: Output.object({
						description: strategy.outputDescription,
						name: strategy.outputName,
						schema: jsonSchema<AiTurnDecision>(strategy.outputSchema),
					}),
					prompt,
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

	const cachedGenerators = new Map<string, AiTurnGenerator>()
	const cachedGenerate: AiTurnGenerator = (context) => {
		const gameKind = context.publicView.gameKind
		let cached = cachedGenerators.get(gameKind)
		if (cached === undefined) {
			cached = wrapAiGeneratorWithVarmint(
				`ai-natural-v5-${gameKind}-${modelId}`,
				generate,
				options.squirrel,
			)
			cachedGenerators.set(gameKind, cached)
		}
		return cached(context)
	}
	const guarded = createGuardedAiTurnGenerator(cachedGenerate, {
		onFallback: (details) => {
			serverLogger.warn("ai.strategy.fallback", {
				...details,
				modelId,
			})
			options.onFallback?.(details)
		},
	})

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
