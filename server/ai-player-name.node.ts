import type { SeededRandom } from "../src/game/seeded-random.ts"

export const AI_NAME_MAXIMUM_LENGTH = 18

export const cuteAiAdjectives = [
	"Bouncy",
	"Bubbly",
	"Chirpy",
	"Coy",
	"Crinkly",
	"Cuddly",
	"Dainty",
	"Dewy",
	"Dimpled",
	"Dizzy",
	"Dreamy",
	"Fancy",
	"Fizzy",
	"Fluffy",
	"Frilly",
	"Fuzzy",
	"Giggly",
	"Glowy",
	"Goofy",
	"Happy",
	"Honeyed",
	"Itsy",
	"Jazzy",
	"Jingly",
	"Jolly",
	"Kooky",
	"Lacy",
	"Lilting",
	"Loopy",
	"Mellow",
	"Mopsy",
	"Nifty",
	"Peachy",
	"Peppy",
	"Perky",
	"Pippy",
	"Plushy",
	"Poppy",
	"Pouting",
	"Pudgy",
	"Puffy",
	"Rosy",
	"Sassy",
	"Shiny",
	"Silky",
	"Sleepy",
	"Smiley",
	"Snuggly",
	"Sparkly",
	"Spiffy",
	"Spry",
	"Squishy",
	"Starry",
	"Sulky",
	"Sunny",
	"Teeny",
	"Tinsel",
	"Toasty",
	"Twinkly",
	"Wiggly",
	"Winky",
	"Wobbly",
	"Zany",
	"Zippy",
] as const

export const metalAiNounPhrases = [
	"Axeman",
	"Banshee",
	"Blackout",
	"Blazer",
	"Bloodaxe",
	"Bolt",
	"Bone King",
	"Breaker",
	"Brimstone",
	"Crusher",
	"Darkstar",
	"Death Ray",
	"Deathlord",
	"Doom Bat",
	"Doomlord",
	"Dragoon",
	"Dreadwolf",
	"Firebrand",
	"Frostbite",
	"Ghostfire",
	"Grim Fang",
	"Gunner",
	"Havoc",
	"Hell Hawk",
	"Hellion",
	"Iron Fang",
	"Ironhide",
	"Knell",
	"Marauder",
	"Mayhem",
	"Moonbane",
	"Night Hag",
	"Nightjar",
	"Onslaught",
	"Outlaw",
	"Phantom",
	"Ravager",
	"Reaper",
	"Red Ruin",
	"Ripper",
	"Sabertooth",
	"Sandman",
	"Scourge",
	"Shade",
	"Skullbane",
	"Slayer",
	"Soulburn",
	"Steeljaw",
	"Stormcrow",
	"Thunder",
	"Titan",
	"Tormentor",
	"Valkyrie",
	"Vandal",
	"Venom",
	"War Hog",
	"Warlock",
	"Wildfire",
	"Wolf King",
	"Wraith",
	"Wrecker",
	"Wyvern",
	"Zealot",
	"Zero",
] as const

const combinationCount = cuteAiAdjectives.length * metalAiNounPhrases.length

function greatestCommonDivisor(left: number, right: number): number {
	let a = left
	let b = right
	while (b !== 0) {
		const remainder = a % b
		a = b
		b = remainder
	}
	return a
}

function nameAt(index: number): string {
	const adjective =
		cuteAiAdjectives[Math.floor(index / metalAiNounPhrases.length)]
	const nounPhrase = metalAiNounPhrases[index % metalAiNounPhrases.length]
	if (adjective === undefined || nounPhrase === undefined) {
		throw new RangeError("The AI name index is outside the curated vocabulary.")
	}
	return `${adjective} ${nounPhrase}`
}

export function generateAiPlayerName(
	random: SeededRandom,
	existingNames: readonly string[],
): string {
	const claimed = new Set(existingNames.map((name) => name.toLocaleLowerCase()))
	const start = random.integer(combinationCount)
	let stride = random.integer(combinationCount - 1) + 1
	while (greatestCommonDivisor(stride, combinationCount) !== 1) {
		stride = (stride % (combinationCount - 1)) + 1
	}

	for (let attempt = 0; attempt < combinationCount; attempt += 1) {
		const name = nameAt((start + attempt * stride) % combinationCount)
		if (!claimed.has(name.toLocaleLowerCase())) return name
	}
	throw new Error("Every curated AI player name is already in use.")
}
