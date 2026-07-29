import type { AiPlayerRuntime } from "../src/ai/ai-player.node.ts"
import type { AiModelId } from "../src/ai/ai-models.ts"
import type { PlayerId } from "../src/game/game-types.ts"
import type { SeededRandom } from "../src/game/seeded-random.ts"

export type WayfarerGameResources = {
	aiNameRandom: SeededRandom
	aiPlayers: Map<PlayerId, AiPlayerRuntime>
	assignAiSeat: (
		modelId: AiModelId,
		existingPlayerNames: readonly string[],
	) => Promise<{ aiPlayerId: PlayerId; name: string }>
	dealRandom: SeededRandom
	identityRandom: SeededRandom
	removeAiSeat: (aiPlayerId: PlayerId) => void
}
