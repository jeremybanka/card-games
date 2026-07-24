import { describe, expect, it } from "vitest"

import { createSeededRandom } from "./game/seeded-random.ts"
import {
	AI_NAME_MAXIMUM_LENGTH,
	cuteAiAdjectives,
	generateAiPlayerName,
	metalAiNounPhrases,
} from "../server/ai-player-name.node.ts"

const vocabularySeed = "ai-name-vocabulary-v1"
const collisionSeed = "ai-name-collision-v1"
const separationSeed = "ai-name-domain-separation-v1"

describe("AI player names", () => {
	it("provides deep, curated, length-safe word banks", () => {
		expect(cuteAiAdjectives).toHaveLength(64)
		expect(metalAiNounPhrases).toHaveLength(64)
		expect(new Set(cuteAiAdjectives).size).toBe(cuteAiAdjectives.length)
		expect(new Set(metalAiNounPhrases).size).toBe(metalAiNounPhrases.length)

		for (const adjective of cuteAiAdjectives) {
			expect(adjective).toMatch(/^[A-Z][a-z]+$/)
		}
		for (const nounPhrase of metalAiNounPhrases) {
			expect(nounPhrase).toMatch(/^[A-Z][a-z]+(?: [A-Z][a-z]+)?$/)
		}
		for (const adjective of cuteAiAdjectives) {
			for (const nounPhrase of metalAiNounPhrases) {
				expect(`${adjective} ${nounPhrase}`.length).toBeLessThanOrEqual(
					AI_NAME_MAXIMUM_LENGTH,
				)
			}
		}
	})

	it("is reproducible and avoids occupied names deterministically", () => {
		const firstRandom = createSeededRandom(vocabularySeed)
		const secondRandom = createSeededRandom(vocabularySeed)
		const firstNames: string[] = []
		const secondNames: string[] = []

		for (let seat = 0; seat < 32; seat += 1) {
			firstNames.push(generateAiPlayerName(firstRandom, firstNames))
			secondNames.push(generateAiPlayerName(secondRandom, secondNames))
		}

		expect(firstNames).toEqual(secondNames)
		expect(new Set(firstNames).size).toBe(firstNames.length)
	})

	it("walks past collisions without consuming unbounded randomness", () => {
		const probe = createSeededRandom(collisionSeed)
		const occupied = generateAiPlayerName(probe, [])
		const first = createSeededRandom(collisionSeed)
		const second = createSeededRandom(collisionSeed)

		expect(generateAiPlayerName(first, [occupied])).toBe(
			generateAiPlayerName(second, [occupied]),
		)
		expect(first.next()).toBe(second.next())
	})

	it("does not perturb deal or physical-card identity streams", () => {
		const baselineDeal = createSeededRandom(`deal:${separationSeed}`)
		const namedDeal = createSeededRandom(`deal:${separationSeed}`)
		const baselineIdentity = createSeededRandom(`identity:${separationSeed}`)
		const namedIdentity = createSeededRandom(`identity:${separationSeed}`)
		const nameRandom = createSeededRandom(`ai-name:${separationSeed}`)

		generateAiPlayerName(nameRandom, [])
		generateAiPlayerName(nameRandom, ["Pouting War Hog"])

		expect(namedDeal.next()).toBe(baselineDeal.next())
		expect(namedIdentity.uuid()).toBe(baselineIdentity.uuid())
	})
})
