import { getState, setState } from "atom.io"
import { io } from "socket.io-client"
import type { Socket } from "socket.io-client"

import {
	actionErrorAtom,
	clearRoomSession,
	roomSessionAtom,
	saveRoomSession,
} from "./client-state.ts"
import type {
	ClientToServerEvents,
	ServerToClientEvents,
} from "./game/hearts-types.ts"
import { trackConnectionStatus } from "./connection-status.ts"
import { createRandomUuid } from "./random-uuid.ts"

const identityKey = "wayfarer.playerId"
const secretKey = "wayfarer.playerSecret"
const existingIdentity = localStorage.getItem(identityKey)
const existingSecret = localStorage.getItem(secretKey)
const playerId = existingIdentity ?? createRandomUuid()
const playerSecret = existingSecret ?? createRandomUuid()
if (existingIdentity === null) localStorage.setItem(identityKey, playerId)
if (existingSecret === null) localStorage.setItem(secretKey, playerSecret)

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>

export const gameSocket: GameSocket = io({
	auth: { playerId, playerSecret },
})

trackConnectionStatus({
	onConnect: (listener) => gameSocket.on("connect", listener),
	onConnectError: (listener) => gameSocket.on("connect_error", listener),
	onDisconnect: (listener) => gameSocket.on("disconnect", listener),
	onReconnectAttempt: (listener) =>
		gameSocket.io.on("reconnect_attempt", listener),
})

gameSocket.on("connect", () => {
	const session = getState(roomSessionAtom)
	if (session === null) return
	gameSocket.emit(
		"joinRoom",
		session.roomCode,
		session.playerName,
		(result) => {
			if (result.ok) {
				saveRoomSession(result.roomCode, session.playerName)
			} else {
				setState(actionErrorAtom, result.error)
				clearRoomSession()
			}
		},
	)
})

gameSocket.on("roomClosed", (message) => {
	setState(actionErrorAtom, message)
	clearRoomSession()
})
