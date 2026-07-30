import type { SummonersKeyword } from "./summoners-types.ts"

export const SUMMONERS_KEYWORD_GLOSSARY = {
	guard:
		"While a player controls a Guard, enemies attacking that player must choose one of that player's Guards.",
	leech:
		"After a Being with Leech deals combat damage, restore that much life to its Summoner, up to 24.",
	rush: "This Being enters ready and may attack immediately.",
} as const satisfies Record<SummonersKeyword, string>

export function summonersKeywordLink(keyword: SummonersKeyword): string {
	const label = `${keyword[0]?.toUpperCase()}${keyword.slice(1)}`
	return `[${label}](#${keyword})`
}
