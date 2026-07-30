import type { JSONSchema7 } from "ai"
import type { Socket } from "socket.io-client"

import { registeredGameAdapter } from "../game/game-registry.ts"
import type {
	ActionResult,
	ClientToServerEvents,
	ServerToClientEvents,
} from "../game/game-types.ts"
import { heartsAiStrategy } from "./hearts-ai-strategy.ts"
import type { AiGameContextFor } from "./ai-game-facts.ts"
import { ohHellAiStrategy } from "./oh-hell-ai-strategy.ts"
import { summonersAiStrategy } from "./summoners-ai-strategy.ts"
import type {
	AiGameKind,
	AiNextActionFor,
	AiTurnDecisionFor,
} from "./ai-types.ts"

export type AiActionSocket = Socket<ServerToClientEvents, ClientToServerEvents>

export type AiDecisionParseResult<Kind extends AiGameKind> =
	| { ok: true; value: AiTurnDecisionFor<Kind> }
	| { error: unknown; ok: false }

export type AiGameStrategy<Kind extends AiGameKind> = {
	fallbackDecision: (context: AiGameContextFor<Kind>) => AiTurnDecisionFor<Kind>
	isLegalAction: (
		context: AiGameContextFor<Kind>,
		action: AiNextActionFor<Kind>,
	) => boolean
	outputDescription: string
	outputName: string
	outputSchema: JSONSchema7
	parseDecision: (input: unknown) => AiDecisionParseResult<Kind>
	privateViewForStrategy: (
		view: AiGameContextFor<Kind>["privateView"],
	) => AiGameContextFor<Kind>["privateView"]
	submitAction: (
		socket: AiActionSocket,
		action: AiNextActionFor<Kind>,
		context: AiGameContextFor<Kind>,
	) => Promise<ActionResult>
	systemPrompt: string
	usesTurnGenerator: (context: AiGameContextFor<Kind>) => boolean
}

const strategies = {
	hearts: heartsAiStrategy,
	ohHell: ohHellAiStrategy,
	summoners: summonersAiStrategy,
} as const satisfies {
	[Kind in AiGameKind]: AiGameStrategy<Kind>
}

export function aiGameStrategy<Kind extends AiGameKind>(
	gameKind: Kind,
): AiGameStrategy<Kind> {
	return registeredGameAdapter<AiGameStrategy<Kind>>(gameKind, strategies)
}
