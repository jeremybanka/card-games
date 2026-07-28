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
		expect(stylesheet).toMatch(
			/&\[data-hover-active\]:not\(\[data-card-active\]\) \{\s*pointer-events: auto;[\s\S]*?> hand-card \{\s*pointer-events: auto;/,
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

	it("moves the card face without moving its pointer target while picking", () => {
		expect(stylesheet).not.toMatch(/&\[data-hovered\] \{\s*transform:/)
		expect(stylesheet).not.toMatch(
			/&\[data-picking\]:not\(\[data-hovered\]\) \{\s*transform:/,
		)
		expect(stylesheet).toMatch(
			/&\[data-hovered\] \{[\s\S]*?> button > card-face \{[\s\S]*?transform: translate\(/,
		)
		expect(stylesheet).toMatch(
			/&\[data-picking\]:not\(\[data-hovered\]\) \{[\s\S]*?> button > card-face \{\s*transform: translateY\(-1\.15rem\) scale\(1\.3\);/,
		)
		expect(stylesheet).toMatch(/> card-face \{[\s\S]*?pointer-events: none;/)
	})

	it("enlarges focused cards without compounding the dragged scale", () => {
		expect(stylesheet).toMatch(
			/&:not\(\[data-hovered\], \[data-picking\], \[data-dragging\], \[data-play-pending\]\):has\(\s*> button:focus-visible\s*\) \{[\s\S]*?transform: scale\(1\.2\);/,
		)
	})
})
