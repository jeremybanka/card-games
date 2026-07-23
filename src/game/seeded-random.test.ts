import { describe, expect, it } from "vitest"

import { createSeededRandom } from "./seeded-random.ts"

describe("seeded LCG randomness", () => {
	it("repeats numbers, integers, and UUIDs for the same seed", () => {
		const first = createSeededRandom("hearts-replay-v1")
		const second = createSeededRandom("hearts-replay-v1")
		const expected = [
			0.45859154243953526,
			7,
			"97bba62e-0aa4-435b-a143-d498cc0b3b33",
			0.5158360439818352,
		]

		expect([
			first.next(),
			first.integer(23),
			first.uuid(),
			first.next(),
		]).toEqual(expected)
		expect([
			second.next(),
			second.integer(23),
			second.uuid(),
			second.next(),
		]).toEqual(expected)
	})

	it("separates different seeds", () => {
		const first = createSeededRandom("first")
		const second = createSeededRandom("second")

		expect([first.next(), first.uuid()]).not.toEqual([
			second.next(),
			second.uuid(),
		])
	})

	it("emits RFC 4122 version-four-shaped identifiers", () => {
		expect(createSeededRandom(42).uuid()).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		)
	})
})
