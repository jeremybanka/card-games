import type { VNode } from "preact"

import css from "./ScorecardLockup.module.css"

export function ScorecardLockup({
	points,
	tricks,
}: {
	points: number
	tricks: number
}): VNode {
	return (
		<scorecard-lockup
			aria-label={`${tricks} ${tricks === 1 ? "trick" : "tricks"}, ${points} ${points === 1 ? "point" : "points"}`}
			className={css.class}
		>
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
