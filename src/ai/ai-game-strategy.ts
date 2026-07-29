import type { JSONSchema7 } from "ai"
import type { Socket } from "socket.io-client"

import { registeredGameAdapter } from "../game/game-registry.ts"
import type {
	ActionResult,
	ClientToServerEvents,
	GameKind,
	ServerToClientEvents,
} from "../game/game-types.ts"
import { heartsAiStrategy } from "./hearts-ai-strategy.ts"
import type { AiGameContextFor } from "./ai-game-facts.ts"
import { ohHellAiStrategy } from "./oh-hell-ai-strategy.ts"
import type { AiNextActionFor, AiTurnDecisionFor } from "./ai-types.ts"

export type AiActionSocket = Socket<ServerToClientEvents, ClientToServerEvents>

export type AiDecisionParseResult<Kind extends GameKind> =
	| { ok: true; value: AiTurnDecisionFor<Kind> }
	| { error: unknown; ok: false }

export type AiGameStrategy<Kind extends GameKind> = {
	fallbackDecision: (context: AiGameContextFor<Kind>) => AiTurnDecisionFor<Kind>
	isLegalAction: (
		context: AiGameContextFor<Kind>,
		action: AiNextActionFor<Kind>,
	) => boolean
	outputDescription: string
	outputName: string
	outputSchema: JSONSchema7
	parseDecision: (input: unknown) => AiDecisionParseResult<Kind>
	submitAction: (
		socket: AiActionSocket,
		action: AiNextActionFor<Kind>,
	) => Promise<ActionResult>
	systemPrompt: string
}

const strategies = {
	hearts: heartsAiStrategy,
	ohHell: ohHellAiStrategy,
} as const satisfies {
	[Kind in GameKind]: AiGameStrategy<Kind>
}

export function aiGameStrategy<Kind extends GameKind>(
	gameKind: Kind,
): AiGameStrategy<Kind> {
	return registeredGameAdapter<AiGameStrategy<Kind>>(gameKind, strategies)
}
