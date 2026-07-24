import type { VNode } from "preact"

import type { CardId } from "./game/hearts-types.ts"
import css from "./DeckRemainder.module.css"

export function DeckRemainder({
	cardIds,
}: {
	cardIds: readonly CardId[]
}): VNode {
	const label =
		cardIds.length === 0
			? "Deck is empty"
			: `${cardIds.length} card${cardIds.length === 1 ? "" : "s"} remains in the deck`
	return (
		<deck-remainder
			aria-label={label}
			className={css.class}
			data-card-motion-origin="deck"
			data-empty={cardIds.length === 0 || undefined}
			role="img"
		>
			{cardIds.map((cardId) => (
				<span aria-hidden="true" key={cardId} />
			))}
		</deck-remainder>
	)
}
