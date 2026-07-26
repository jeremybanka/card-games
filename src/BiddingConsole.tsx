import type { VNode } from "preact"
import { useEffect, useMemo, useState } from "preact/hooks"

import type { PlayerId, PublicGameView, Suit } from "./game/hearts-types.ts"
import css from "./BiddingConsole.module.css"

function trumpMark(suit: Suit | null | undefined): string {
	switch (suit) {
		case "clubs":
			return "♣"
		case "diamonds":
			return "♦"
		case "spades":
			return "♠"
		case "hearts":
			return "♥"
		default:
			return "—"
	}
}

export function BiddingConsole({
	game,
	legalBids,
	myPlayerId,
	onSubmitBid,
}: {
	game: PublicGameView
	legalBids: readonly number[]
	myPlayerId: PlayerId
	onSubmitBid: (bid: number) => void
}): VNode {
	const [selectedBid, setSelectedBid] = useState<number | null>(null)
	const myTurn = game.bidPlayerId === myPlayerId
	const dealer = game.dealerId === myPlayerId
	const allBids = useMemo(
		() =>
			Array.from({ length: (game.roundHandSize ?? 0) + 1 }, (_, bid) => bid),
		[game.roundHandSize],
	)
	const legalBidSet = useMemo(() => new Set(legalBids), [legalBids])
	const forbiddenBid = dealer
		? (allBids.find((bid) => !legalBidSet.has(bid)) ?? null)
		: null

	useEffect(() => {
		setSelectedBid(null)
	}, [game.bidPlayerId, game.roundNumber])

	return (
		<bidding-console
			aria-label="Oh Hell bidding"
			aria-live="polite"
			className={css.class}
			data-my-turn={myTurn || undefined}
		>
			<bid-header>
				<small>ROUND {game.roundNumber} · CALL YOUR TRICKS</small>
				<bid-title>
					<trump-chip
						aria-label={`${game.trumpSuit ?? "No"} trump`}
						data-red={
							game.trumpSuit === "diamonds" ||
							game.trumpSuit === "hearts" ||
							undefined
						}
					>
						{trumpMark(game.trumpSuit)}
					</trump-chip>
					<heading-group>
						<h2>{myTurn ? "Place your bid" : game.statusMessage}</h2>
						<p>
							{game.roundHandSize} cards · {game.bidsSubmitted} of{" "}
							{game.players.length} called
						</p>
					</heading-group>
				</bid-title>
			</bid-header>

			<bid-table aria-label="Bids at the table">
				{game.players.map((player) => (
					<player-bid
						data-current={game.bidPlayerId === player.id || undefined}
						data-dealer={game.dealerId === player.id || undefined}
						key={player.id}
					>
						<span>{player.name}</span>
						<bid-stack data-empty={player.bid === null || undefined}>
							{player.bid ?? "?"}
						</bid-stack>
						<small>
							{game.dealerId === player.id
								? "dealer"
								: player.bid === null
									? "thinking"
									: "called"}
						</small>
					</player-bid>
				))}
			</bid-table>

			{myTurn ? (
				<form
					onSubmit={(event) => {
						event.preventDefault()
						if (selectedBid === null || !legalBidSet.has(selectedBid)) return
						onSubmitBid(selectedBid)
					}}
				>
					<fieldset>
						<legend>Choose the number of tricks you will take</legend>
						<chip-rail>
							{allBids.map((bid) => {
								const legal = legalBidSet.has(bid)
								return (
									<label
										data-disabled={!legal || undefined}
										data-selected={selectedBid === bid || undefined}
										key={bid}
									>
										<input
											type="radio"
											name="oh-hell-bid"
											value={bid}
											aria-label={`${bid} ${bid === 1 ? "trick" : "tricks"}`}
											checked={selectedBid === bid}
											disabled={!legal}
											onChange={() => setSelectedBid(bid)}
										/>
										<bid-chip aria-hidden="true">
											<strong>{bid}</strong>
											<span>{bid === 1 ? "trick" : "tricks"}</span>
										</bid-chip>
									</label>
								)
							})}
						</chip-rail>
					</fieldset>
					{forbiddenBid === null ? (
						<p>Choose a chip, then push it into the pot.</p>
					) : (
						<p data-hook>
							Dealer hook: {forbiddenBid} is blocked so total bids cannot match{" "}
							{game.roundHandSize} tricks.
						</p>
					)}
					<button type="submit" disabled={selectedBid === null}>
						{selectedBid === null
							? "Choose a chip"
							: `Bid ${selectedBid} ${selectedBid === 1 ? "trick" : "tricks"}`}
					</button>
				</form>
			) : (
				<waiting-rail role="status">
					<bid-chip aria-hidden="true">
						<span>WAIT</span>
					</bid-chip>
					<p>The chips move clockwise. Your hand stays private.</p>
				</waiting-rail>
			)}
		</bidding-console>
	)
}
