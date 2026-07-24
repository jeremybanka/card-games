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
	type AiGuardObserver,
	type AiTurnGenerator,
} from "./ai-strategy.ts"
import { aiTurnDecisionJsonSchema, type AiTurnDecision } from "./ai-types.ts"

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
	const wrapped = squirrel.add(key, generate)
	return async (context) => {
		const {
			awardedLeftoverCard: _awardedLeftoverCard,
			...cacheablePrivateView
		} = context.privateView
		const { deckCardIds: _deckCardIds, ...publicViewWithoutDeck } =
			context.publicView
		const cacheablePublicView = {
			...publicViewWithoutDeck,
			completedTricks: publicViewWithoutDeck.completedTricks.map(
				({ leftoverAward: _leftoverAward, ...trick }) => trick,
			),
		}
		const cacheableContext = {
			...context,
			privateView: cacheablePrivateView,
			publicView: cacheablePublicView,
		} as typeof context
		return wrapped
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
	}
}

const systemPrompt = [
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
].join("\n")

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
