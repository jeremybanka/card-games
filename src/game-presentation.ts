import type {
	CompletedTrick,
	PlayerId,
	PublicGameView,
	TrickPlay,
} from "./game/hearts-types.ts"

export function capturedTrickCount(
	capturedCardCount: number,
	playerCount: number,
): number {
	return Math.floor(capturedCardCount / playerCount)
}

export function completedTrickKey(game: PublicGameView): string | null {
	if (game.completedTricks.length === 0) return null
	return `${game.roomCode}:round-${game.roundNumber}-trick-${game.completedTricks.length}`
}

export function orderedTrickReviewPlays(
	trick: CompletedTrick,
): readonly TrickPlay[] {
	const winner = trick.plays.find((play) => play.playerId === trick.winnerId)
	if (winner === undefined) return trick.plays
	return [
		...trick.plays.filter((play) => play.playerId !== trick.winnerId),
		winner,
	]
}

export function shouldAutoDismissTrickReview(
	game: PublicGameView,
	myPlayerId: PlayerId,
	trick: CompletedTrick,
): boolean {
	if (game.phase !== "playing" || game.currentPlayerId !== myPlayerId) {
		return false
	}
	const trickTakerIsLeading =
		trick.winnerId === myPlayerId &&
		game.trickLeaderId === myPlayerId &&
		game.currentTrick.length === 0
	return !trickTakerIsLeading
}
