import type { VNode } from "preact"

import type { PublicPlayerView } from "./game/game-types.ts"
import { PlayerAvatar } from "./PlayerAvatar.tsx"
import css from "./PlayerNameplate.module.css"

export function PlayerNameplate({
	detail,
	meta,
	player,
	seatIndex,
	surface = "default",
}: {
	detail?: string | undefined
	meta?: string | undefined
	player: PublicPlayerView
	seatIndex: number
	surface?: "default" | "lobby" | "opponent" | "score"
}): VNode {
	return (
		<player-nameplate className={css.class} data-surface={surface}>
			<PlayerAvatar
				decorative
				name={player.name}
				seatIndex={seatIndex}
				size={surface === "opponent" ? "small" : "medium"}
			/>
			<nameplate-copy>
				<nameplate-line>
					<strong title={player.name}>{player.name}</strong>
					{player.kind === "ai" ? (
						<small aria-label="AI player">AI</small>
					) : null}
				</nameplate-line>
				{detail === undefined ? null : <small>{detail}</small>}
			</nameplate-copy>
			{meta === undefined ? null : <span>{meta}</span>}
		</player-nameplate>
	)
}
