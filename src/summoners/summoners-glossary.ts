import type {
	SummonersCardDefinition,
	SummonersKeyword,
} from "./summoners-types.ts"

export const SUMMONERS_KEYWORD_GLOSSARY = {
	guard:
		"While a player controls a Guard, enemies attacking that player must choose one of that player's Guards.",
	leech:
		"After a Being with Leech deals combat damage, restore that much life to its Summoner, up to 24.",
	rush: "This Being enters ready and may attack immediately.",
} as const satisfies Record<SummonersKeyword, string>

export function summonersCardKeywords(
	card: Pick<SummonersCardDefinition, "grantedKeywords" | "keywords">,
): SummonersKeyword[] {
	return [
		...new Set([...(card.keywords ?? []), ...(card.grantedKeywords ?? [])]),
	]
}

export function summonersKeywordLabel(keyword: SummonersKeyword): string {
	return `${keyword[0]?.toUpperCase()}${keyword.slice(1)}`
}

export function summonersKeywordLink(keyword: SummonersKeyword): string {
	return `[${summonersKeywordLabel(keyword)}](#${keyword})`
}
