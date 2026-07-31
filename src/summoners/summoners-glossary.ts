import type {
	SummonersCardDefinition,
	SummonersKeyword,
} from "./summoners-types.ts"

export const SUMMONERS_KEYWORD_GLOSSARY = {
	blaze:
		"The first time each turn this Being's Summoner spends their last Spark, ready this Being.",
	current:
		"The first time each turn this Being's Summoner draws a card outside the start-of-turn draw, ready this Being.",
	guard:
		"While a player controls a Guard, enemies attacking that player must choose one of that player's Guards.",
	leech:
		"After a Being with Leech deals combat damage, restore that much life to its Summoner, up to 24.",
	molt:
		"The first time each turn this Being survives combat with another Being, it gets +1 Attack and +1 Energy while it remains on the battlefield.",
	rooted:
		"At the end of its Summoner's turn, if this Being is ready and damaged, restore 2 Energy to it.",
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
