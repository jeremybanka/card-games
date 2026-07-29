import type { VNode } from "preact"

import { aiModelLabel } from "./ai/ai-models.ts"
import { rankMark, suitMark } from "./card-mark.ts"
import type {
	AiStrategyReview as AiStrategyReviewData,
	CardValue,
} from "./game/game-types.ts"
import css from "./AiStrategyReview.module.css"

type AiStrategyReviewProps = {
	onClose: () => void
	review: AiStrategyReviewData
}

function cardLabel(card: CardValue): string {
	return `${rankMark(card.rank)}${suitMark(card.suit)}`
}

export function AiStrategyReview({
	onClose,
	review,
}: AiStrategyReviewProps): VNode {
	return (
		<ai-strategy-review
			aria-label={`${review.playerName} strategy log`}
			aria-modal="true"
			className={css.class}
			role="dialog"
		>
			<review-header>
				<review-title>
					<small>ROUND {review.roundNumber} · STRATEGY LOG</small>
					<h2>{review.playerName}</h2>
					<p>{aiModelLabel(review.modelId)}</p>
				</review-title>
				<button type="button" aria-label="Close strategy log" onClick={onClose}>
					×
				</button>
			</review-header>
			<section aria-label="Turn-by-turn strategy">
				{review.turns.length === 0 ? (
					<empty-review>
						<strong>No decisions recorded</strong>
						<p>This player did not take an AI turn during the round.</p>
					</empty-review>
				) : (
					review.turns.map((turn, index) => (
						<article key={`${turn.turnKey}-${index}`}>
							<turn-header>
								<turn-number>{String(index + 1).padStart(2, "0")}</turn-number>
								<turn-heading>
									<small>
										{turn.phase === "passing"
											? "PASS"
											: turn.phase === "bidding"
												? "BID"
												: `TRICK ${turn.trickNumber + 1}`}
									</small>
									<strong>
										{turn.action.kind === "playCard"
											? `Played ${cardLabel(turn.action.card)}`
											: turn.action.kind === "submitBid"
												? `Bid ${turn.action.bid}`
												: `Passed ${turn.action.cards
														.map(cardLabel)
														.join(" · ")}`}
									</strong>
								</turn-heading>
							</turn-header>
							<dl>
								<dt>Saw</dt>
								<dd>{turn.observation}</dd>
								<dt>Thought</dt>
								<dd>{turn.plan}</dd>
								<dt>Did</dt>
								<dd>
									{turn.action.kind === "playCard"
										? `Committed ${cardLabel(turn.action.card)} to the trick.`
										: turn.action.kind === "submitBid"
											? `Committed to taking ${turn.action.bid} trick${turn.action.bid === 1 ? "" : "s"}.`
											: `Sent ${turn.action.cards
													.map(cardLabel)
													.join(", ")} across the table.`}
								</dd>
							</dl>
						</article>
					))
				)}
			</section>
		</ai-strategy-review>
	)
}
