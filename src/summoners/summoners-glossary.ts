import type {
	SummonersCardDefinition,
	SummonersKeyword,
} from "./summoners-types.ts"

export const SUMMONERS_KEYWORD_GLOSSARY = {
	blaze:
		"The first time each turn this Being's Summoner spends their last Spark, ready this Being.",
	breakthrough:
		"When this Being attacks another Being, excess combat damage is dealt to that Being's Summoner.",
	current:
		"The first time each turn this Being's Summoner draws a card outside the start-of-turn draw, ready this Being.",
	guard:
		"While a player controls a Guard, enemies attacking that player must choose one of that player's Guards.",
	leech:
		"After a Being with Leech deals combat damage, restore that much life to its Summoner, up to 24.",
	molt:
		"The first time each turn this Being survives combat with another Being, it gets +1 Attack while it remains on the battlefield.",
	rooted:
		"At the end of its Summoner's turn, if this Being is ready and damaged, restore 2 Energy to it.",
	rush: "This Being enters ready and may attack immediately.",
	tend:
		"Once each turn, this ready Being may become weary to put a growth counter on another friendly Being. Each growth counter gives +1 Attack and +1 Energy.",
} as const satisfies Record<SummonersKeyword, string>

export function summonersCardKeywords(
	card: Pick<SummonersCardDefinition, "grantedKeywords" | "keywords"> &
		Partial<Pick<SummonersCardDefinition, "rules">>,
): SummonersKeyword[] {
	const keywords = new Set([
		...(card.keywords ?? []),
		...(card.grantedKeywords ?? []),
	])
	for (const keyword of Object.keys(
		SUMMONERS_KEYWORD_GLOSSARY,
	) as SummonersKeyword[]) {
		if (new RegExp(`\\b${keyword}\\b`, "i").test(card.rules ?? "")) {
			keywords.add(keyword)
		}
	}
	return [...keywords]
}

export function summonersKeywordLabel(keyword: SummonersKeyword): string {
	return `${keyword[0]?.toUpperCase()}${keyword.slice(1)}`
}

export function summonersKeywordLink(keyword: SummonersKeyword): string {
	return `[${summonersKeywordLabel(keyword)}](#${keyword})`
}
