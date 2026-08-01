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
import type { AiTurnDecisionFor, SummonersAiAction } from "./ai-types.ts"

const targetPattern = "^P[0-3](?::B[0-4])?$"

const summonersActionJsonSchema: JSONSchema7 = {
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
				attacker: {
					pattern: "^P[0-3]:B[0-4]$",
					type: "string",
				},
				target: { pattern: targetPattern, type: "string" },
			},
			required: ["action", "attacker", "target"],
			type: "object",
		},
		{
			additionalProperties: false,
			properties: {
				action: { enum: ["tend"], type: "string" },
				target: {
					pattern: "^P[0-3]:B[0-4]$",
					type: "string",
				},
				tender: {
					pattern: "^P[0-3]:B[0-4]$",
					type: "string",
				},
			},
			required: ["action", "target", "tender"],
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
}

const summonersAiTurnDecisionJsonSchema: JSONSchema7 = {
	additionalProperties: false,
	properties: {
		actionReason: { type: "string" },
		nextAction: summonersActionJsonSchema,
		turnObjective: { type: "string" },
	},
	required: ["turnObjective", "actionReason", "nextAction"],
	type: "object",
}

function playerIndex(
	context: AiGameContextFor<"summoners">,
	playerId: string,
): number {
	return context.publicView.players.findIndex(
		(player) => player.id === playerId,
	)
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

export function summonersLegalActionLines(
	context: AiGameContextFor<"summoners">,
): string[] {
	if (context.publicView.phase === "lobby") {
		return SUMMONERS_DECK_IDS.map((deck) => `- Select deck \`${deck}\`.`)
	}
	const me = myPlayer(context)
	const lines: string[] = []
	for (const card of context.privateView.hand) {
		if (!context.privateView.playableCardIds.includes(card.physicalId)) continue
		const targets = targetsFor(context, card.targeting)
		if (card.targeting === "none") {
			lines.push(`- Play \`${card.name}\` with target \`null\`.`)
		} else if (targets.length > 0) {
			lines.push(
				`- Play \`${card.name}\` targeting ${targets
					.map((target) => `\`${summonersTargetReference(context, target)}\``)
					.join(", ")}.`,
			)
		}
	}
	const myIndex = playerIndex(context, context.playerId)
	const attackTargetRefs = attackTargets(context).map(
		(target) => `\`${summonersTargetReference(context, target)}\``,
	)
	for (const [beingIndex, being] of me.battlefield.entries()) {
		if (!being.ready || attackTargetRefs.length === 0) continue
		lines.push(
			`- Attack with \`P${myIndex}:B${beingIndex}\` targeting ${attackTargetRefs.join(", ")}.`,
		)
	}
	for (const [beingIndex, being] of me.battlefield.entries()) {
		if (!being.ready || !being.keywords.includes("tend")) continue
		const targets = me.battlefield
			.map((_, targetIndex) => targetIndex)
			.filter((targetIndex) => targetIndex !== beingIndex)
		if (targets.length > 0) {
			lines.push(
				`- Tend with \`P${myIndex}:B${beingIndex}\` targeting ${targets
					.map((targetIndex) => `\`P${myIndex}:B${targetIndex}\``)
					.join(", ")}.`,
			)
		}
	}
	const power = me.summoner?.power
	if (power !== undefined && !me.powerUsed && me.spark >= power.cost) {
		const targets = targetsFor(context, power.targeting)
		if (power.targeting === "none") {
			lines.push(`- Use \`${power.name}\` with target \`null\`.`)
		} else if (targets.length > 0) {
			lines.push(
				`- Use \`${power.name}\` targeting ${targets
					.map((target) => `\`${summonersTargetReference(context, target)}\``)
					.join(", ")}.`,
			)
		}
	}
	lines.push("- End the turn.")
	return lines
}

function myPlayer(
	context: AiGameContextFor<"summoners">,
): SummonersPublicPlayerView {
	const player = context.publicView.players.find(
		(candidate) => candidate.id === context.playerId,
	)
	if (player === undefined)
		throw new Error("The AI is not seated at this table.")
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
			actionReason: "Select a starter deck before the game can begin.",
			currentPlan:
				"Choose a distinct starter philosophy, then learn its curve.",
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
			actionReason:
				"Use available readiness for immediate pressure against the first legal target.",
			currentPlan:
				"Turn ready Beings toward the opposing Summoner while respecting Guards.",
			nextAction: {
				action: "attack",
				attacker: `P${playerIndex(context, context.playerId)}:B${readyAttacker}`,
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
			actionReason:
				"Convert available Spark into the strongest legal board development.",
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
			actionReason:
				"Convert spare Spark into the Summoner's once-per-turn advantage.",
			currentPlan:
				"Use spare Spark through the Summoner before yielding the invocation.",
			nextAction: { action: "usePower", target: powerTarget },
		}
	}

	return {
		actionReason:
			"No remaining legal action improves the board or converts expiring resources.",
		currentPlan:
			"Preserve the remaining hand and pass priority when no profitable action remains.",
		nextAction: { action: "endTurn" },
	}
}

function isLegalSummonersAtomicAction(
	context: AiGameContextFor<"summoners">,
	action: SummonersAiAction,
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
		const myIndex = playerIndex(context, context.playerId)
		const attacker = new RegExp(`^P${myIndex}:B(\\d)$`).exec(action.attacker)
		const being =
			attacker === null ? undefined : me.battlefield[Number(attacker[1])]
		return (
			being?.ready === true &&
			attackTargets(context)
				.map((target) => summonersTargetReference(context, target))
				.includes(action.target)
		)
	}
	if (action.action === "tend") {
		const myIndex = playerIndex(context, context.playerId)
		const tenderMatch = new RegExp(`^P${myIndex}:B(\\d)$`).exec(action.tender)
		const targetMatch = new RegExp(`^P${myIndex}:B(\\d)$`).exec(action.target)
		const tender =
			tenderMatch === null ? undefined : me.battlefield[Number(tenderMatch[1])]
		return (
			tender?.ready === true &&
			tender.keywords.includes("tend") &&
			action.tender !== action.target &&
			targetMatch !== null &&
			me.battlefield[Number(targetMatch[1])] !== undefined
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

function isLegalSummonersAction(
	context: AiGameContextFor<"summoners">,
	action: SummonersAiAction,
): boolean {
	return isLegalSummonersAtomicAction(context, action)
}

function isSummonersAction(input: unknown): input is SummonersAiAction {
	if (typeof input !== "object" || input === null) return false
	const action = input as Record<string, unknown>
	const validTarget = (target: unknown): boolean =>
		typeof target === "string" && /^P[0-3](?::B[0-4])?$/.test(target)
	switch (action.action) {
		case "attack":
			return (
				typeof action.attacker === "string" &&
				/^P[0-3]:B[0-4]$/.test(action.attacker) &&
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
		case "tend":
			return (
				typeof action.tender === "string" &&
				/^P[0-3]:B[0-4]$/.test(action.tender) &&
				typeof action.target === "string" &&
				/^P[0-3]:B[0-4]$/.test(action.target)
			)
		case "usePower":
			return validTarget(action.target) || action.target === null
		default:
			return false
	}
}

function parseSummonersDecision(
	input: unknown,
):
	| { ok: true; value: AiTurnDecisionFor<"summoners"> }
	| { error: unknown; ok: false } {
	if (typeof input !== "object" || input === null) {
		return { error: new Error("Invalid Summoners AI decision."), ok: false }
	}
	const decision = input as Record<string, unknown>
	if (
		typeof decision.turnObjective !== "string" ||
		typeof decision.actionReason !== "string" ||
		decision.actionReason.length === 0 ||
		!isSummonersAction(decision.nextAction)
	) {
		return { error: new Error("Invalid Summoners AI decision."), ok: false }
	}
	return {
		ok: true,
		value: {
			actionReason: decision.actionReason,
			currentPlan: decision.turnObjective,
			nextAction: decision.nextAction,
		},
	}
}

export const summonersAiStrategy: AiGameStrategy<"summoners"> = {
	fallbackDecision: fallbackSummonersDecision,
	isLegalAction: isLegalSummonersAction,
	outputDescription:
		"A turn objective, a concise reason comparing the immediate alternatives, and exactly one legal Summoners action for the current state.",
	outputName: "summoners_next_action",
	outputSchema: summonersAiTurnDecisionJsonSchema,
	parseDecision: parseSummonersDecision,
	privateViewForStrategy: (view) => view,
	submitAction: async (socket, action, context) => {
		switch (action.action) {
				case "selectDeck":
					return new Promise((resolve) => {
						socket.emit("selectSummonersDeck", action.deck, resolve)
					})
				case "playCard": {
					const card = context.privateView.hand.find(
						(candidate) => candidate.name === action.card,
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
					const attacker = resolveSummonersTargetReference(
						context,
						action.attacker,
					)
					const target = resolveSummonersTargetReference(context, action.target)
					if (attacker?.kind !== "being" || target === null) {
						throw new Error("The AI selected a missing combatant.")
					}
					return new Promise((resolve) => {
						socket.emit("attackSummoners", attacker.cardId, target, resolve)
					})
				}
				case "tend": {
					const tender = resolveSummonersTargetReference(context, action.tender)
					const target = resolveSummonersTargetReference(context, action.target)
					if (tender?.kind !== "being" || target?.kind !== "being") {
						throw new Error("The AI selected a missing Being to Tend.")
					}
					return new Promise((resolve) => {
						socket.emit("tendSummoners", tender.cardId, target.cardId, resolve)
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
	},
	systemPrompt: [
		"You are a strategic Summoners player in a living card game.",
		"Choose exactly one legal action for the current state. After the server validates and resolves it, you will observe the resulting state and choose again if your turn continues.",
		"At the start of a turn, establish one concise turnObjective. During that turn, repeat the supplied objective verbatim; do not replace it with a description of the last action.",
		"Give an actionReason that compares the chosen action with the most relevant immediate alternative.",
		"Players are P0 through P3. Their Beings are Pn:B0 through Pn:B4.",
		"Character references describe only the current state and may change after this action resolves.",
		"Never invent hidden opponent card values. Opponent hands expose counts and opaque backs only.",
		"Summoners has no blocking or response window. A ready Being does not protect its Summoner unless it has Guard; readiness is useful only for a listed action or a specific end-of-turn effect such as Rooted.",
		"Spark and unused readiness do not carry into future turns. Take profitable actions before ending the turn.",
		"Before choosing endTurn, audit every ready attacker, affordable card, ready Tend action, unused affordable power, and damaged ready Rooted Being shown in the context. The actionReason must explain why passing those opportunities is preferable.",
		"Maintain or revise a coherent turn-level plan as each authoritative result arrives. Spend Spark efficiently, respect Guards, and account for simultaneous combat and once-per-turn keyword triggers.",
		"Growth is permanent +1 Attack/+1 Energy. A Tend action spends the tender's readiness, so compare it against attacking or preserving Rooted recovery.",
	].join("\n"),
	usesTurnGenerator: () => true,
}
