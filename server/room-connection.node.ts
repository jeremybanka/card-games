export type DisposableConnection = {
	dispose: () => void
}

export function prepareRoomConnection<PlayerId extends string>({
	connections,
	currentRoomCode,
	leaveCurrentRoom,
	nextRoomCode,
	playerId,
}: {
	connections: Map<PlayerId, DisposableConnection>
	currentRoomCode: string | undefined
	leaveCurrentRoom: () => void
	nextRoomCode: string
	playerId: PlayerId
}): void {
	if (currentRoomCode !== nextRoomCode) {
		leaveCurrentRoom()
		return
	}

	const previousConnection = connections.get(playerId)
	previousConnection?.dispose()
	connections.delete(playerId)
}
