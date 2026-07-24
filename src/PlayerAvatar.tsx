import type { VNode } from "preact"

import { playerInitials } from "./player-avatar.ts"
import css from "./PlayerAvatar.module.css"

const avatarColors = ["#bb5a65", "#547fa8", "#a17645", "#5f8c72"] as const

export function PlayerAvatar({
	decorative = false,
	name,
	seatIndex,
	size = "medium",
}: {
	decorative?: boolean
	name: string
	seatIndex: number
	size?: "large" | "medium" | "small"
}): VNode {
	return (
		<player-avatar
			aria-hidden={decorative || undefined}
			aria-label={decorative ? undefined : `${name}'s avatar`}
			className={css.class}
			data-size={size}
			style={{
				backgroundColor: avatarColors[Math.max(0, seatIndex) % 4],
			}}
		>
			{playerInitials(name)}
		</player-avatar>
	)
}
