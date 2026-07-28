export const OPENAI_HEARTS_MODELS = [
	{
		description: "Strongest strategic play; highest latency and cost.",
		id: "gpt-5.6-sol",
		label: "GPT-5.6 Sol",
	},
	{
		description: "Balanced strategy, speed, and cost.",
		id: "gpt-5.6-terra",
		label: "GPT-5.6 Terra",
	},
	{
		description: "Fastest, lightest-weight opponent.",
		id: "gpt-5.6-luna",
		label: "GPT-5.6 Luna",
	},
] as const

export type AiModelId = (typeof OPENAI_HEARTS_MODELS)[number]["id"]

export const DEFAULT_AI_MODEL_ID: AiModelId = "gpt-5.6-luna"

export function isAiModelId(input: unknown): input is AiModelId {
	return OPENAI_HEARTS_MODELS.some((model) => model.id === input)
}

export function aiModelLabel(modelId: AiModelId): string {
	return (
		OPENAI_HEARTS_MODELS.find((model) => model.id === modelId)?.label ?? modelId
	)
}
