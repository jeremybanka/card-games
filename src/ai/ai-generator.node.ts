import { createHash } from "node:crypto"

import { createOpenAI } from "@ai-sdk/openai"
import { generateText, jsonSchema, type JSONSchema7, Output } from "ai"
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
import type { AiGameKind, AiTurnDecision } from "./ai-types.ts"

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
	maxOutputTokens?: number
	onFallback?: NonNullable<AiGuardObserver["onFallback"]>
	onModelResponse?: (record: AiModelResponseRecord) => void
	requestAttempts?: number
	requestTimeoutMs?: number
	squirrel?: Squirrel
}

export class AiGenerationTimeoutError extends Error {}

export async function generateAiWithDeadline<T>(
	generate: (abortSignal: AbortSignal) => Promise<T>,
	timeoutMs: number,
): Promise<T> {
	const controller = new AbortController()
	let timeout: ReturnType<typeof setTimeout> | undefined
	const deadline = new Promise<never>((_, reject) => {
		timeout = setTimeout(() => {
			const error = new AiGenerationTimeoutError(
				`AI generation exceeded ${timeoutMs}ms.`,
			)
			controller.abort(error)
			reject(error)
		}, timeoutMs)
	})
	try {
		return await Promise.race([generate(controller.signal), deadline])
	} finally {
		if (timeout !== undefined) clearTimeout(timeout)
	}
}

export async function retryAiGeneration<T>(
	generate: (attempt: number) => Promise<T>,
	attempts: number,
	onRetry?: (error: unknown, attempt: number) => void,
	shouldRetry: (error: unknown) => boolean = () => true,
): Promise<T> {
	const attemptLimit = Math.max(1, Math.floor(attempts))
	let lastError: unknown
	for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
		try {
			return await generate(attempt)
		} catch (error) {
			lastError = error
			if (attempt >= attemptLimit || !shouldRetry(error)) break
			onRetry?.(error, attempt)
		}
	}
	throw lastError
}

export type AiGenerationContract = {
	modelId: AiModelId
	output: {
		description: string
		name: string
		schema: JSONSchema7
	}
	prompt: string
	providerOptions: {
		openai: {
			reasoningEffort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh"
			textVerbosity: "low" | "medium" | "high"
		}
	}
	system: string
}

export function aiGenerationContract(
	gameKind: AiGameKind,
	modelId: AiModelId,
	prompt: string,
): AiGenerationContract {
	const strategy = aiGameStrategy(gameKind)
	return {
		modelId,
		output: {
			description: strategy.outputDescription,
			name: strategy.outputName,
			schema: strategy.outputSchema,
		},
		prompt,
		providerOptions: {
			openai: {
				reasoningEffort: "low",
				textVerbosity: "low",
			},
		},
		system: strategy.systemPrompt,
	}
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

export function promptFixtureKey(
	context: AiGameContext,
	contract: AiGenerationContract,
): string {
	const playerIndex = context.publicView.players.findIndex(
		(player) => player.id === context.playerId,
	)
	const player = playerIndex === -1 ? context.playerId : `P${playerIndex}`
	const readableKey =
		context.publicView.gameKind === "summoners"
			? `turn-${context.publicView.turnNumber}-revision-${context.publicView.revision}-${context.publicView.phase}-${player}`
			: context.publicView.phase === "playing"
				? `round-${context.publicView.roundNumber}-trick-${
						context.publicView.trickNumber + 1
					}-play-${context.publicView.currentTrick.length + 1}-${player}`
				: `round-${context.publicView.roundNumber}-${context.publicView.phase}-${player}`
	const inputHash = createHash("sha256")
		.update(JSON.stringify(contract))
		.digest("hex")
		.slice(0, 12)
	return `${readableKey}--${inputHash}`
}

export function wrapAiGeneratorWithVarmint(
	key: string,
	modelId: AiModelId,
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
		const contract = aiGenerationContract(
			context.publicView.gameKind,
			modelId,
			prompt,
		)
		sourceContexts.set(prompt, context)
		try {
			return await wrapped.for(promptFixtureKey(context, contract)).get(prompt)
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
	const maxOutputTokens = options.maxOutputTokens ?? 1_000
	const requestAttempts = options.requestAttempts ?? 2
	const requestTimeoutMs = options.requestTimeoutMs ?? 45_000
	const generate: AiTurnGenerator = async (context): Promise<AiTurnDecision> =>
		serverLogger.withSpan(
			"ai.openai.generate",
			{
				modelId,
				phase: context.publicView.phase,
				playerId: context.playerId,
				roomCode: context.publicView.roomCode,
				roundNumber:
					context.publicView.gameKind === "summoners"
						? undefined
						: context.publicView.roundNumber,
				trickNumber:
					context.publicView.gameKind === "summoners"
						? undefined
						: context.publicView.trickNumber,
				turnNumber:
					context.publicView.gameKind === "summoners"
						? context.publicView.turnNumber
						: undefined,
			},
			async (span) => {
				const gameKind = context.publicView.gameKind
				const prompt = renderAiGameFacts(context)
				const contract = aiGenerationContract(gameKind, modelId, prompt)
				span.event("ai.prompt.rendered", {
					prompt,
					systemPrompt: contract.system,
				})
				const result = await retryAiGeneration(
					(attempt) =>
						generateAiWithDeadline(
							(abortSignal) =>
								generateText({
									abortSignal,
									maxOutputTokens,
									maxRetries: 0,
									model,
									output: Output.object({
										description: contract.output.description,
										name: contract.output.name,
										schema: jsonSchema<AiTurnDecision>(contract.output.schema),
									}),
									prompt: contract.prompt,
									providerOptions:
										attempt === 1
											? contract.providerOptions
											: {
													openai: {
														...contract.providerOptions.openai,
														reasoningEffort: "none",
													},
												},
									system: contract.system,
								}),
							requestTimeoutMs,
						),
					requestAttempts,
					(error, attempt) => {
						span.event(
							"ai.openai.retry",
							{
								attempt,
								error: error instanceof Error ? error.message : String(error),
								requestTimeoutMs,
							},
							"warn",
						)
					},
					(error) => !(error instanceof AiGenerationTimeoutError),
				)
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
			const contractVersion = gameKind === "summoners" ? "v7" : "v5"
			cached = wrapAiGeneratorWithVarmint(
				`ai-natural-${contractVersion}-${gameKind}-${modelId}`,
				modelId,
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
				roundNumber:
					context.publicView.gameKind === "summoners"
						? undefined
						: context.publicView.roundNumber,
				trickNumber:
					context.publicView.gameKind === "summoners"
						? undefined
						: context.publicView.trickNumber,
				turnNumber:
					context.publicView.gameKind === "summoners"
						? context.publicView.turnNumber
						: undefined,
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
