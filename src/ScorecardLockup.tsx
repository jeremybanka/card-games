import type { VNode } from "preact"

import css from "./ScorecardLockup.module.css"

export function ScorecardLockup({
	bid,
	points,
	tricks,
}: {
	bid?: number | null | undefined
	points: number
	tricks: number
}): VNode {
	const bidLabel = bid === undefined ? "" : `, ${bid ?? "no"} bid`
	return (
		<scorecard-lockup
			aria-label={`${tricks} ${tricks === 1 ? "trick" : "tricks"}${bidLabel}, ${points} ${points === 1 ? "point" : "points"}`}
			className={css.class}
			data-with-bid={bid !== undefined || undefined}
		>
			{bid === undefined ? null : (
				<score-counter data-kind="bid">
					<small>Bid</small>
					<output>{bid ?? "—"}</output>
				</score-counter>
			)}
			<score-counter data-kind="tricks">
				<small>Tricks</small>
				<output>{tricks}</output>
			</score-counter>
			<score-counter data-kind="points">
				<small>Points</small>
				<output>{points}</output>
			</score-counter>
		</scorecard-lockup>
	)
}
