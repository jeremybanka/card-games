import type { VNode } from "preact"

import type {
	CompletedTrick,
	PlayerId,
	PublicGameView,
	Suit,
	VisibleCard,
} from "./game/hearts-types.ts"
import { orderedTrickReviewPlays } from "./game-presentation.ts"
import css from "./GameTransitions.module.css"
import { PlayerAvatar } from "./PlayerAvatar.tsx"

function suitMark(suit: Suit): string {
	switch (suit) {
		case "clubs":
			return "♣"
		case "diamonds":
			return "♦"
		case "spades":
			return "♠"
		case "hearts":
			return "♥"
	}
}

function rankMark(rank: VisibleCard["rank"]): string {
	switch (rank) {
		case 11:
			return "J"
		case 12:
			return "Q"
		case 13:
			return "K"
		case 14:
			return "A"
		default:
			return String(rank)
	}
}

function TurnBanner({
	game,
	myPlayerId,
}: {
	game: PublicGameView
	myPlayerId: PlayerId
}): VNode {
	const player = game.players.find(
		(candidate) => candidate.id === game.currentPlayerId,
	)
	const label =
		player?.id === myPlayerId
			? "Your turn"
			: `${player?.name ?? "Another player"}'s turn`
	return (
		<turn-banner
			aria-atomic="true"
			aria-label={label}
			aria-live="polite"
			role="status"
		>
			<banner-line data-edge="top" />
			<banner-panel>
				<small>NEXT TO PLAY</small>
				<strong>{label}</strong>
			</banner-panel>
			<banner-line data-edge="bottom" />
		</turn-banner>
	)
}

function TrickReview({
	awardedLeftoverCard,
	game,
	myPlayerId,
	onDismiss,
	trick,
}: {
	awardedLeftoverCard: VisibleCard | null
	game: PublicGameView
	myPlayerId: PlayerId
	onDismiss: () => void
	trick: CompletedTrick
}): VNode {
	const winner = game.players.find((player) => player.id === trick.winnerId)
	const orderedPlays = orderedTrickReviewPlays(trick)
	const middle = (orderedPlays.length - 1) / 2
	const title = `${winner?.name ?? "The high card"} takes the trick`
	return (
		<trick-review aria-label={title} aria-modal="true" role="dialog">
			<review-scrim />
			<review-heading>
				<small>TRICK {game.completedTricks.length}</small>
				<h2>{title}</h2>
				<span>Highest card in the led suit wins.</span>
			</review-heading>
			<review-stack aria-label="Completed trick">
				{orderedPlays.map((play, index) => {
					const player = game.players.find(
						(candidate) => candidate.id === play.playerId,
					)
					const seat = Math.max(
						0,
						game.players.findIndex(
							(candidate) => candidate.id === play.playerId,
						),
					)
					const distance = index - middle
					const isWinner = play.playerId === trick.winnerId
					const landingDelay = 90 + index * 155
					const cardLabel = `${rankMark(play.card.rank)} of ${play.card.suit}`
					return (
						<review-position
							key={play.card.id}
							style={{
								transform: `translate(calc(-50% + ${distance * 18}px), calc(-50% + ${Math.abs(distance) * 5 - index * 3}px)) rotate(${distance * 5.5}deg)`,
								zIndex: index + 1,
							}}
						>
							<review-card
								aria-label={`${player?.name ?? "Player"} played ${cardLabel}${isWinner ? " and won" : ""}`}
								data-red={
									play.card.suit === "diamonds" ||
									play.card.suit === "hearts" ||
									undefined
								}
								data-winner={isWinner || undefined}
								style={{ animationDelay: `${landingDelay}ms` }}
							>
								<card-corner>
									<strong>{rankMark(play.card.rank)}</strong>
									<span>{suitMark(play.card.suit)}</span>
								</card-corner>
								<card-suit aria-hidden="true">
									{suitMark(play.card.suit)}
								</card-suit>
								<review-avatar data-winner={isWinner || undefined}>
									<PlayerAvatar
										decorative
										name={player?.name ?? "Player"}
										seatIndex={seat}
										size="large"
									/>
								</review-avatar>
								{isWinner ? (
									<winning-halo
										aria-hidden="true"
										style={{
											animationDelay: `${landingDelay + 360}ms`,
										}}
									/>
								) : null}
							</review-card>
						</review-position>
					)
				})}
			</review-stack>
			{trick.leftoverAward === null ? null : (
				<leftover-award
					aria-label={`${winner?.name ?? "The trick winner"} receives the leftover card`}
				>
					{trick.leftoverAward.recipientId === myPlayerId &&
					awardedLeftoverCard !== null ? (
						<award-card
							aria-label={`${rankMark(awardedLeftoverCard.rank)} of ${awardedLeftoverCard.suit}`}
							data-red={
								awardedLeftoverCard.suit === "diamonds" ||
								awardedLeftoverCard.suit === "hearts" ||
								undefined
							}
						>
							<strong>{rankMark(awardedLeftoverCard.rank)}</strong>
							<span>{suitMark(awardedLeftoverCard.suit)}</span>
						</award-card>
					) : (
						<award-card aria-label="Face-down card" data-hidden>
							<span aria-hidden="true">✦</span>
						</award-card>
					)}
					<award-copy>
						<strong>
							{trick.leftoverAward.recipientId === myPlayerId
								? "You receive the leftover card"
								: `${winner?.name ?? "The trick winner"} receives the leftover card`}
						</strong>
						<span>
							The first trick winner collects the remaining card. The deck is
							now empty.
						</span>
					</award-copy>
				</leftover-award>
			)}
			<button type="button" onClick={onDismiss}>
				Continue to next trick
			</button>
		</trick-review>
	)
}

export function GameTransitions({
	awardedLeftoverCard,
	game,
	myPlayerId,
	onDismissTrick,
	review,
}: {
	awardedLeftoverCard: VisibleCard | null
	game: PublicGameView
	myPlayerId: PlayerId
	onDismissTrick: () => void
	review: CompletedTrick | null
}): VNode {
	const turnKey = [
		game.roundNumber,
		game.trickNumber,
		game.currentTrick.length,
		game.currentPlayerId,
	].join(":")
	return (
		<game-transitions className={css.class}>
			{review === null ? (
				game.phase === "playing" && game.currentPlayerId !== null ? (
					<TurnBanner game={game} key={turnKey} myPlayerId={myPlayerId} />
				) : null
			) : (
				<TrickReview
					awardedLeftoverCard={awardedLeftoverCard}
					game={game}
					myPlayerId={myPlayerId}
					onDismiss={onDismissTrick}
					trick={review}
				/>
			)}
		</game-transitions>
	)
}
