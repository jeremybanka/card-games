import type { PassDirection } from "./game-types.ts"

function assertPlayerCount(playerCount: number): void {
	if (!Number.isInteger(playerCount) || playerCount < 1) {
		throw new RangeError("Player count must be a positive integer.")
	}
}

export function normalizedSeatIndex(
	index: number,
	playerCount: number,
): number {
	assertPlayerCount(playerCount)
	return ((index % playerCount) + playerCount) % playerCount
}

/**
 * Returns how many clockwise turns separate the local seat from another seat.
 * Stored player order advances clockwise, so +1 is the player immediately left
 * of the local player and -1 is the player immediately right.
 */
export function clockwiseSeatOffset(
	localSeatIndex: number,
	seatIndex: number,
	playerCount: number,
): number {
	return normalizedSeatIndex(seatIndex - localSeatIndex, playerCount)
}

export function clockwiseOpponentSeatIndices(
	localSeatIndex: number,
	playerCount: number,
): number[] {
	assertPlayerCount(playerCount)
	return Array.from({ length: Math.max(0, playerCount - 1) }, (_, offset) =>
		normalizedSeatIndex(localSeatIndex + offset + 1, playerCount),
	)
}

export function passRecipientSeatIndex(
	senderSeatIndex: number,
	playerCount: number,
	direction: PassDirection,
): number {
	switch (direction) {
		case "left":
			return normalizedSeatIndex(senderSeatIndex + 1, playerCount)
		case "right":
			return normalizedSeatIndex(senderSeatIndex - 1, playerCount)
		case "across":
			return normalizedSeatIndex(
				senderSeatIndex + (playerCount === 4 ? 2 : 1),
				playerCount,
			)
		case "hold":
			return normalizedSeatIndex(senderSeatIndex, playerCount)
	}
}

export function passSenderSeatIndex(
	recipientSeatIndex: number,
	playerCount: number,
	direction: PassDirection,
): number {
	switch (direction) {
		case "left":
			return normalizedSeatIndex(recipientSeatIndex - 1, playerCount)
		case "right":
			return normalizedSeatIndex(recipientSeatIndex + 1, playerCount)
		case "across":
			return normalizedSeatIndex(
				recipientSeatIndex - (playerCount === 4 ? 2 : 1),
				playerCount,
			)
		case "hold":
			return normalizedSeatIndex(recipientSeatIndex, playerCount)
	}
}

export function clockwiseSeatPosition(
	clockwiseOffset: number,
	playerCount: number,
): { left: number; top: number } {
	assertPlayerCount(playerCount)
	const angle = Math.PI / 2 - (clockwiseOffset / playerCount) * Math.PI * 2
	return {
		left: 50 - Math.cos(angle) * 33,
		top: 50 + Math.sin(angle) * 34,
	}
}
