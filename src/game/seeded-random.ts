export type SeededRandom = {
	integer: (maximumExclusive: number) => number
	next: () => number
	seed: string
	uuid: () => string
}

function hashSeed(seed: string): number {
	let hash = 2_166_136_261
	for (const character of new TextEncoder().encode(seed)) {
		hash ^= character
		hash = Math.imul(hash, 16_777_619)
	}
	return hash >>> 0
}

function uuidFromWords(words: readonly number[]): string {
	const bytes = new Uint8Array(16)
	for (const [wordIndex, word] of words.entries()) {
		for (let byteIndex = 0; byteIndex < 4; byteIndex += 1) {
			bytes[wordIndex * 4 + byteIndex] = (word >>> (byteIndex * 8)) & 0xff
		}
	}
	bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40
	bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80
	const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"))
	return [
		hex.slice(0, 4).join(""),
		hex.slice(4, 6).join(""),
		hex.slice(6, 8).join(""),
		hex.slice(8, 10).join(""),
		hex.slice(10).join(""),
	].join("-")
}

export function createSeededRandom(seedInput: number | string): SeededRandom {
	const seed = String(seedInput)
	let value =
		typeof seedInput === "number" ? seedInput >>> 0 : hashSeed(seedInput)

	const nextWord = (): number => {
		value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0
		return value
	}
	const next = (): number => nextWord() / 4_294_967_296

	return {
		integer: (maximumExclusive) => {
			if (!Number.isSafeInteger(maximumExclusive) || maximumExclusive <= 0) {
				throw new RangeError("The random integer bound must be positive.")
			}
			return Math.floor(next() * maximumExclusive)
		},
		next,
		seed,
		uuid: () => uuidFromWords([nextWord(), nextWord(), nextWord(), nextWord()]),
	}
}
