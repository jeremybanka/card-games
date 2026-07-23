import { useI, useO } from "atom.io/react"
import type { VNode } from "preact"

import css from "./AppShell.module.css"
import { questCountAtom } from "./quest-state.ts"

export function AppShell(): VNode {
	const questCount = useO(questCountAtom)
	const setQuestCount = useI(questCountAtom)

	return (
		<app-shell className={css.class}>
			<header>
				<a href="/" aria-label="Wayfarer Quest home">
					Wayfarer Quest
				</a>
			</header>
			<main>
				<quest-counter>
					<p>Your journey has begun.</p>
					<output aria-label="Quests charted">{questCount}</output>
					<button
						type="button"
						onClick={() => {
							setQuestCount((count) => count + 1)
						}}
					>
						Chart another quest
					</button>
				</quest-counter>
			</main>
			<footer>Built for the road ahead.</footer>
		</app-shell>
	)
}
