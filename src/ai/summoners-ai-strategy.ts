import type { JSONSchema7 } from "ai"

import { SUMMONERS_DECK_IDS } from "../summoners/summoners-cards.ts"
import type {
	SummonersPublicPlayerView,
	SummonersTarget,
	SummonersTargeting,
	SummonersVisibleCard,
} from "../summoners/summoners-types.ts"
import type { AiGameStrategy } from "./ai-game-strategy.ts"
import type { AiGameContextFor } from "./ai-game-facts.ts"
import type {
	AiTurnDecisionFor,
	SummonersAiNextAction,
} from "./ai-types.ts"

const targetPattern = "^P[0-3](?::B[0-4])?$"

const summonersAiTurnDecisionJsonSchema: JSONSchema7 = {
	additionalProperties: false,
	properties: {
		currentPlan: { type: "string" },
		nextAction: {
			anyOf: [
				{
					additionalProperties: false,
					properties: {
						action: { enum: ["selectDeck"], type: "string" },
						deck: { enum: [...SUMMONERS_DECK_IDS], type: "string" },
					},
					required: ["action", "deck"],
					type: "object",
				},
				{
					additionalProperties: false,
					properties: {
						action: { enum: ["playCard"], type: "string" },
						card: { type: "string" },
						target: {
							anyOf: [
								{ pattern: targetPattern, type: "string" },
								{ type: "null" },
							],
						},
					},
					required: ["action", "card", "target"],
					type: "object",
				},
				{
					additionalProperties: false,
					properties: {
						action: { enum: ["attack"], type: "string" },
						attacker: { pattern: "^B[0-4]$", type: "string" },
						target: { pattern: targetPattern, type: "string" },
					},
					required: ["action", "attacker", "target"],
					type: "object",
				},
				{
					additionalProperties: false,
					properties: {
						action: { enum: ["usePower"], type: "string" },
						target: {
							anyOf: [
								{ pattern: targetPattern, type: "string" },
								{ type: "null" },
							],
						},
					},
					required: ["action", "target"],
					type: "object",
				},
				{
					additionalProperties: false,
					properties: {
						action: { enum: ["endTurn"], type: "string" },
					},
					required: ["action"],
					type: "object",
				},
			],
		},
	},
	required: ["currentPlan", "nextAction"],
	type: "object",
}

function playerIndex(
	context: AiGameContextFor<"summoners">,
	playerId: string,
): number {
	return context.publicView.players.findIndex((player) => player.id === playerId)
}

export function summonersTargetReference(
	context: AiGameContextFor<"summoners">,
	target: SummonersTarget,
): string {
	const ownerIndex = playerIndex(context, target.playerId)
	if (target.kind === "summoner") return `P${ownerIndex}`
	const owner = context.publicView.players[ownerIndex]
	const beingIndex =
		owner?.battlefield.findIndex(
			(being) => being.card.physicalId === target.cardId,
		) ?? -1
	return `P${ownerIndex}:B${beingIndex}`
}

export function resolveSummonersTargetReference(
	context: AiGameContextFor<"summoners">,
	reference: string,
): SummonersTarget | null {
	const match = /^P(\d)(?::B(\d))?$/.exec(reference)
	if (match === null) return null
	const owner = context.publicView.players[Number(match[1])]
	if (owner === undefined) return null
	if (match[2] === undefined) return { kind: "summoner", playerId: owner.id }
	const being = owner.battlefield[Number(match[2])]
	return being === undefined
		? null
		: {
				cardId: being.card.physicalId,
				kind: "being",
				playerId: owner.id,
			}
}

function targetsFor(
	context: AiGameContextFor<"summoners">,
	targeting: SummonersTargeting,
): SummonersTarget[] {
	const targets: SummonersTarget[] = []
	for (const player of context.publicView.players) {
		if (player.eliminated) continue
		const friendly = player.id === context.playerId
		const summoner = { kind: "summoner" as const, playerId: player.id }
		if (
			(targeting === "anyEnemy" && !friendly) ||
			(targeting === "enemySummoner" && !friendly) ||
			(targeting === "friendlyCharacter" && friendly)
		) {
			targets.push(summoner)
		}
		for (const being of player.battlefield) {
			const target = {
				cardId: being.card.physicalId,
				kind: "being" as const,
				playerId: player.id,
			}
			if (
				(targeting === "anyEnemy" && !friendly) ||
				(targeting === "enemyBeing" && !friendly) ||
				(targeting === "friendlyBeing" && friendly) ||
				(targeting === "friendlyCharacter" && friendly)
			) {
				targets.push(target)
			}
		}
	}
	return targets
}

function targetReferenceFor(
	context: AiGameContextFor<"summoners">,
	targeting: SummonersTargeting,
): string | null | undefined {
	if (targeting === "none") return null
	const target = targetsFor(context, targeting)[0]
	return target === undefined
		? undefined
		: summonersTargetReference(context, target)
}

function attackTargets(
	context: AiGameContextFor<"summoners">,
): SummonersTarget[] {
	const targets: SummonersTarget[] = []
	for (const player of context.publicView.players) {
		if (player.id === context.playerId || player.eliminated) continue
		const guards = player.battlefield.filter((being) =>
			being.keywords.includes("guard"),
		)
		if (guards.length > 0) {
			for (const guard of guards) {
				targets.push({
					cardId: guard.card.physicalId,
					kind: "being",
					playerId: player.id,
				})
			}
			continue
		}
		targets.push({ kind: "summoner", playerId: player.id })
		for (const being of player.battlefield) {
			targets.push({
				cardId: being.card.physicalId,
				kind: "being",
				playerId: player.id,
			})
		}
	}
	return targets
}

function myPlayer(
	context: AiGameContextFor<"summoners">,
): SummonersPublicPlayerView {
	const player = context.publicView.players.find(
		(candidate) => candidate.id === context.playerId,
	)
	if (player === undefined) throw new Error("The AI is not seated at this table.")
	return player
}

function playableCard(
	context: AiGameContextFor<"summoners">,
	name: string,
): SummonersVisibleCard | undefined {
	return context.privateView.hand.find(
		(card) =>
			card.name === name &&
			context.privateView.playableCardIds.includes(card.physicalId) &&
			targetReferenceFor(context, card.targeting) !== undefined,
	)
}

function fallbackSummonersDecision(
	context: AiGameContextFor<"summoners">,
): AiTurnDecisionFor<"summoners"> {
	const me = myPlayer(context)
	if (context.publicView.phase === "lobby") {
		const index = Math.max(0, playerIndex(context, context.playerId))
		return {
			currentPlan: "Choose a distinct starter philosophy, then learn its curve.",
			nextAction: {
				action: "selectDeck",
				deck: SUMMONERS_DECK_IDS[index % SUMMONERS_DECK_IDS.length]!,
			},
		}
	}

	const readyAttacker = me.battlefield.findIndex((being) => being.ready)
	const attackTarget = attackTargets(context)[0]
	if (readyAttacker !== -1 && attackTarget !== undefined) {
		return {
			currentPlan:
				"Turn ready Beings toward the opposing Summoner while respecting Guards.",
			nextAction: {
				action: "attack",
				attacker: `B${readyAttacker}`,
				target: summonersTargetReference(context, attackTarget),
			},
		}
	}

	const playable = context.privateView.hand
		.filter((card) =>
			context.privateView.playableCardIds.includes(card.physicalId),
		)
		.filter((card) => targetReferenceFor(context, card.targeting) !== undefined)
		.sort(
			(left, right) =>
				Number(right.type === "being") - Number(left.type === "being") ||
				right.cost - left.cost,
		)[0]
	if (playable !== undefined) {
		return {
			currentPlan:
				"Develop the strongest legal board presence, then convert it into pressure.",
			nextAction: {
				action: "playCard",
				card: playable.name,
				target: targetReferenceFor(context, playable.targeting) ?? null,
			},
		}
	}

	const power = me.summoner?.power
	const powerTarget =
		power === undefined
			? undefined
			: targetReferenceFor(context, power.targeting)
	if (
		power !== undefined &&
		!me.powerUsed &&
		me.spark >= power.cost &&
		powerTarget !== undefined
	) {
		return {
			currentPlan:
				"Use spare Spark through the Summoner before yielding the invocation.",
			nextAction: { action: "usePower", target: powerTarget },
		}
	}

	return {
		currentPlan:
			"Preserve the remaining hand and pass priority when no profitable action remains.",
		nextAction: { action: "endTurn" },
	}
}

function isLegalSummonersAction(
	context: AiGameContextFor<"summoners">,
	action: SummonersAiNextAction,
): boolean {
	const me = myPlayer(context)
	if (action.action === "selectDeck") {
		return (
			context.publicView.phase === "lobby" &&
			me.deck === null &&
			SUMMONERS_DECK_IDS.includes(action.deck)
		)
	}
	if (
		context.publicView.phase !== "playing" ||
		context.publicView.currentPlayerId !== context.playerId ||
		me.eliminated
	) {
		return false
	}
	if (action.action === "endTurn") return true
	if (action.action === "playCard") {
		const card = playableCard(context, action.card)
		if (card === undefined) return false
		const validTargets = targetsFor(context, card.targeting).map((target) =>
			summonersTargetReference(context, target),
		)
		return card.targeting === "none"
			? action.target === null
			: action.target !== null && validTargets.includes(action.target)
	}
	if (action.action === "attack") {
		const attacker = /^B(\d)$/.exec(action.attacker)
		const being =
			attacker === null ? undefined : me.battlefield[Number(attacker[1])]
		return (
			being?.ready === true &&
			attackTargets(context)
				.map((target) => summonersTargetReference(context, target))
				.includes(action.target)
		)
	}
	const power = me.summoner?.power
	if (power === undefined || me.powerUsed || me.spark < power.cost) return false
	const validTargets = targetsFor(context, power.targeting).map((target) =>
		summonersTargetReference(context, target),
	)
	return power.targeting === "none"
		? action.target === null
		: action.target !== null && validTargets.includes(action.target)
}

function isSummonersDecision(input: unknown): input is AiTurnDecisionFor<"summoners"> {
	if (typeof input !== "object" || input === null) return false
	const decision = input as Record<string, unknown>
	if (
		typeof decision.currentPlan !== "string" ||
		typeof decision.nextAction !== "object" ||
		decision.nextAction === null
	) {
		return false
	}
	const action = decision.nextAction as Record<string, unknown>
	const validTarget = (target: unknown): boolean =>
		typeof target === "string" && /^P[0-3](?::B[0-4])?$/.test(target)
	switch (action.action) {
		case "attack":
			return (
				typeof action.attacker === "string" &&
				/^B[0-4]$/.test(action.attacker) &&
				validTarget(action.target)
			)
		case "endTurn":
			return true
		case "playCard":
			return (
				typeof action.card === "string" &&
				action.card.length > 0 &&
				(validTarget(action.target) || action.target === null)
			)
		case "selectDeck":
			return (
				typeof action.deck === "string" &&
				SUMMONERS_DECK_IDS.includes(
					action.deck as (typeof SUMMONERS_DECK_IDS)[number],
				)
			)
		case "usePower":
			return validTarget(action.target) || action.target === null
		default:
			return false
	}
}

export const summonersAiStrategy: AiGameStrategy<"summoners"> = {
	fallbackDecision: fallbackSummonersDecision,
	isLegalAction: isLegalSummonersAction,
	outputDescription:
		"A legal Summoners action plus a concise plan for the current invocation.",
	outputName: "summoners_turn_decision",
	outputSchema: summonersAiTurnDecisionJsonSchema,
	parseDecision: (input) =>
		isSummonersDecision(input)
			? { ok: true, value: input }
			: { error: new Error("Invalid Summoners AI decision."), ok: false },
	privateViewForStrategy: (view) => view,
	submitAction: (socket, action, context) => {
		switch (action.action) {
			case "selectDeck":
				return new Promise((resolve) => {
					socket.emit("selectSummonersDeck", action.deck, resolve)
				})
			case "playCard": {
				const card = context.privateView.hand.find(
					(candidate) =>
						candidate.name === action.card &&
						context.privateView.playableCardIds.includes(
							candidate.physicalId,
						),
				)
				if (card === undefined) {
					throw new Error("The AI selected a card outside its legal hand.")
				}
				return new Promise((resolve) => {
					socket.emit(
						"playSummonersCard",
						card.physicalId,
						action.target === null
							? null
							: resolveSummonersTargetReference(context, action.target),
						resolve,
					)
				})
			}
			case "attack": {
				const attackerIndex = Number(action.attacker.slice(1))
				const attacker = myPlayer(context).battlefield[attackerIndex]
				const target = resolveSummonersTargetReference(context, action.target)
				if (attacker === undefined || target === null) {
					throw new Error("The AI selected a missing combatant.")
				}
				return new Promise((resolve) => {
					socket.emit(
						"attackSummoners",
						attacker.card.physicalId,
						target,
						resolve,
					)
				})
			}
			case "usePower":
				return new Promise((resolve) => {
					socket.emit(
						"useSummonerPower",
						action.target === null
							? null
							: resolveSummonersTargetReference(context, action.target),
						resolve,
					)
				})
			case "endTurn":
				return new Promise((resolve) => {
					socket.emit("endSummonersTurn", resolve)
				})
		}
		throw new Error("Summoners cannot submit that AI action.")
	},
	systemPrompt: [
		"You are a strategic Summoners player in a living card game.",
		"Choose exactly one action from the current legal possibilities.",
		"Players are P0 through P3. Their Beings are Pn:B0 through Pn:B4. Your attackers are B0 through B4.",
		"Never invent hidden opponent card values. Opponent hands expose counts and opaque backs only.",
		"Develop Beings, equip useful Items, spend Spark efficiently, respect Guards, and pressure an enemy Summoner.",
		"Keep the plan terse and reusable across the rest of the invocation.",
	].join("\n"),
	usesTurnGenerator: () => true,
}
