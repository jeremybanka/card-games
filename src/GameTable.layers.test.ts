import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

const stylesheet = readFileSync(
	new URL("./GameTable.module.css", import.meta.url),
	"utf8",
)
const transitionStylesheet = readFileSync(
	new URL("./GameTransitions.module.css", import.meta.url),
	"utf8",
)

describe("game table stacking contract", () => {
	it("orders semantic layers from the table through overlays", () => {
		const layerNames = [
			"table",
			"table-zone",
			"table-card",
			"embellishment",
			"floating-zone",
			"hand",
			"active-card",
			"overlay",
		]
		const layers = layerNames.map((name) => {
			const match = stylesheet.match(new RegExp(`--z-${name}: (?<value>\\d+);`))
			return Number(match?.groups?.value)
		})
		expect(layers).toEqual([...layers].sort((left, right) => left - right))
		expect(new Set(layers).size).toBe(layerNames.length)
	})

	it("raises both card-owning ancestors while leaving broad surfaces transparent", () => {
		expect(
			Array.from(stylesheet.matchAll(/&\[data-card-active\]/g)),
		).toHaveLength(2)
		expect(stylesheet).toMatch(
			/> pass-zone \{[\s\S]*?&\[data-card-active\] \{[\s\S]*?z-index: var\(--z-active-card\);[\s\S]*?pointer-events: none;/,
		)
		expect(stylesheet).toMatch(
			/> player-hand \{[\s\S]*?z-index: var\(--z-hand\);[\s\S]*?pointer-events: none;[\s\S]*?&\[data-card-active\] \{[\s\S]*?z-index: var\(--z-active-card\);/,
		)
	})

	it("keeps overlays and transitions above active cards", () => {
		for (const selector of ["action-toast", "card-flight", "score-sheet"]) {
			expect(stylesheet).toMatch(
				new RegExp(`> ${selector} \\{[\\s\\S]*?z-index: var\\(--z-overlay\\);`),
			)
		}
		for (const selector of ["turn-banner", "trick-review"]) {
			expect(transitionStylesheet).toMatch(
				new RegExp(`> ${selector} \\{[\\s\\S]*?z-index: var\\(--z-overlay\\);`),
			)
		}
	})
})
