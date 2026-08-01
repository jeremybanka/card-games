export const OH_HELL_PLAYER_MINIMUM = 3
export const OH_HELL_PLAYER_MAXIMUM = 12
export const OH_HELL_MAXIMUM_FLAT_ROUNDS = 100

export type OhHellScheduleStyle =
	| "flat"
	| "descending"
	| "ascending"
	| "valley"
	| "mountain"

export type OhHellFlatSchedule = {
	handSize: number
	roundCount: number
	style: "flat"
}

export type OhHellRangeSchedule = {
	maximumHandSize: number | null
	minimumHandSize: number
	style: Exclude<OhHellScheduleStyle, "flat">
}

export type OhHellSchedule = OhHellFlatSchedule | OhHellRangeSchedule

export type OhHellRules = {
	awardPittancePoints: boolean
	requireTrumpBreak: boolean
	requireUnsatisfiableBids: boolean
	schedule: OhHellSchedule
}

export const STANDARD_PAGAT_OH_HELL_RULES = {
	awardPittancePoints: false,
	requireTrumpBreak: false,
	requireUnsatisfiableBids: true,
	schedule: {
		maximumHandSize: null,
		minimumHandSize: 1,
		style: "valley",
	},
} as const satisfies OhHellRules

export const HALFWAY_STYLE_OH_HELL_RULES = {
	awardPittancePoints: false,
	requireTrumpBreak: true,
	requireUnsatisfiableBids: true,
	schedule: {
		maximumHandSize: 8,
		minimumHandSize: 1,
		style: "valley",
	},
} as const satisfies OhHellRules

export class OhHellRulesError extends Error {}

function record(input: unknown, label: string): Record<string, unknown> {
	if (typeof input !== "object" || input === null || Array.isArray(input)) {
		throw new OhHellRulesError(`${label} must be an object.`)
	}
	return input as Record<string, unknown>
}

function boolean(input: unknown, label: string): boolean {
	if (typeof input !== "boolean") {
		throw new OhHellRulesError(`${label} must be true or false.`)
	}
	return input
}

function integer(
	input: unknown,
	label: string,
	minimum: number,
	maximum: number,
): number {
	if (
		typeof input !== "number" ||
		!Number.isInteger(input) ||
		input < minimum ||
		input > maximum
	) {
		throw new OhHellRulesError(
			`${label} must be a whole number from ${minimum} to ${maximum}.`,
		)
	}
	return input
}

function scheduleStyle(input: unknown): OhHellScheduleStyle {
	if (
		input === "flat" ||
		input === "descending" ||
		input === "ascending" ||
		input === "valley" ||
		input === "mountain"
	) {
		return input
	}
	throw new OhHellRulesError("Choose a supported round schedule.")
}

export function parseOhHellRules(input: unknown): OhHellRules {
	const candidate = record(input, "Oh Hell rules")
	const scheduleCandidate = record(candidate.schedule, "The round schedule")
	const style = scheduleStyle(scheduleCandidate.style)
	const schedule: OhHellSchedule =
		style === "flat"
			? {
					handSize: integer(scheduleCandidate.handSize, "The hand size", 1, 17),
					roundCount: integer(
						scheduleCandidate.roundCount,
						"The round count",
						1,
						OH_HELL_MAXIMUM_FLAT_ROUNDS,
					),
					style,
				}
			: {
					maximumHandSize:
						scheduleCandidate.maximumHandSize === null
							? null
							: integer(
									scheduleCandidate.maximumHandSize,
									"The maximum hand size",
									1,
									17,
								),
					minimumHandSize: integer(
						scheduleCandidate.minimumHandSize,
						"The minimum hand size",
						1,
						17,
					),
					style,
				}
	return {
		awardPittancePoints: boolean(
			candidate.awardPittancePoints,
			"Pittance scoring",
		),
		requireTrumpBreak: boolean(
			candidate.requireTrumpBreak,
			"The trump-breaking rule",
		),
		requireUnsatisfiableBids: boolean(
			candidate.requireUnsatisfiableBids,
			"The hot-seat rule",
		),
		schedule,
	}
}

export function maximumOhHellHandSize(playerCount: number): number {
	if (
		!Number.isInteger(playerCount) ||
		playerCount < OH_HELL_PLAYER_MINIMUM ||
		playerCount > OH_HELL_PLAYER_MAXIMUM
	) {
		throw new OhHellRulesError(
			`Oh Hell needs ${OH_HELL_PLAYER_MINIMUM} to ${OH_HELL_PLAYER_MAXIMUM} players.`,
		)
	}
	return Math.floor(52 / playerCount)
}

export function pagatOhHellMaximumHandSize(playerCount: number): number {
	const deckMaximum = maximumOhHellHandSize(playerCount)
	const recommendation =
		playerCount <= 5 ? 10 : playerCount === 6 ? 8 : playerCount === 7 ? 7 : 6
	return Math.min(deckMaximum, recommendation)
}

function inclusiveAscending(minimum: number, maximum: number): number[] {
	return Array.from(
		{ length: maximum - minimum + 1 },
		(_, index) => minimum + index,
	)
}

export function deriveOhHellHandSchedule(
	rulesInput: OhHellRules,
	playerCount: number,
): number[] {
	const rules = parseOhHellRules(rulesInput)
	const deckMaximum = maximumOhHellHandSize(playerCount)
	if (rules.schedule.style === "flat") {
		const schedule = rules.schedule
		if (schedule.handSize > deckMaximum) {
			throw new OhHellRulesError(
				`${playerCount} players can receive at most ${deckMaximum} cards each from one deck.`,
			)
		}
		return Array.from({ length: schedule.roundCount }, () => schedule.handSize)
	}

	const maximum =
		rules.schedule.maximumHandSize ?? pagatOhHellMaximumHandSize(playerCount)
	if (maximum > deckMaximum) {
		throw new OhHellRulesError(
			`${playerCount} players can receive at most ${deckMaximum} cards each from one deck.`,
		)
	}
	if (rules.schedule.minimumHandSize > maximum) {
		throw new OhHellRulesError(
			"The minimum hand size cannot exceed the maximum hand size.",
		)
	}
	const ascending = inclusiveAscending(rules.schedule.minimumHandSize, maximum)
	const descending = [...ascending].reverse()
	switch (rules.schedule.style) {
		case "ascending":
			return ascending
		case "descending":
			return descending
		case "valley":
			return [...descending, ...ascending.slice(1)]
		case "mountain":
			return [...ascending, ...descending.slice(1)]
	}
}

export function ohHellRulesErrorForPlayers(
	rules: OhHellRules,
	playerCount: number,
): string | null {
	try {
		deriveOhHellHandSchedule(rules, playerCount)
		return null
	} catch (error) {
		return error instanceof Error
			? error.message
			: "Those rules are not playable."
	}
}
