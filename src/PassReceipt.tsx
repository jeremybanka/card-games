import type { VNode } from "preact"
import { useEffect, useRef } from "preact/hooks"

import type { VisibleCard } from "./game/hearts-types.ts"
import css from "./PassReceipt.module.css"

function suitMark(suit: VisibleCard["suit"]): string {
	return { clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠" }[suit]
}

function rankMark(rank: VisibleCard["rank"]): string {
	if (rank === 11) return "J"
	if (rank === 12) return "Q"
	if (rank === 13) return "K"
	if (rank === 14) return "A"
	return String(rank)
}

export function PassReceipt({
	cards,
	onDismiss,
	senderName,
}: {
	cards: readonly VisibleCard[]
	onDismiss: () => void
	senderName: string
}): VNode {
	const continueButton = useRef<HTMLButtonElement>(null)
	useEffect(() => {
		continueButton.current?.focus()
	}, [])
	return (
		<pass-receipt
			aria-label={`Cards received from ${senderName}`}
			aria-modal="true"
			className={css.class}
			role="dialog"
		>
			<receipt-scrim />
			<receipt-panel>
				<receipt-heading>
					<small>PASS COMPLETE</small>
					<h2>{senderName} passed you</h2>
					<p>These three cards are joining your hand.</p>
				</receipt-heading>
				<receipt-cards aria-label={`Three cards received from ${senderName}`}>
					{cards.map((card) => (
						<receipt-card
							aria-label={`${rankMark(card.rank)} of ${card.suit}`}
							data-card-face="up"
							data-card-id={card.id}
							data-red={
								card.suit === "diamonds" || card.suit === "hearts"
									? ""
									: undefined
							}
							key={card.id}
							role="img"
						>
							<card-corner>
								<strong>{rankMark(card.rank)}</strong>
								<span>{suitMark(card.suit)}</span>
							</card-corner>
							<card-suit aria-hidden="true">{suitMark(card.suit)}</card-suit>
						</receipt-card>
					))}
				</receipt-cards>
				<button ref={continueButton} type="button" onClick={onDismiss}>
					Add cards to my hand
				</button>
			</receipt-panel>
		</pass-receipt>
	)
}
