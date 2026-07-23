import { getState, setState } from "atom.io"
import { io } from "socket.io-client"
import type { Socket } from "socket.io-client"

import {
	actionErrorAtom,
	clearRoomSession,
	connectionStateAtom,
	roomSessionAtom,
	saveRoomSession,
} from "./client-state.ts"
import type {
	ClientToServerEvents,
	ServerToClientEvents,
} from "./game/hearts-types.ts"

const identityKey = "wayfarer.playerId"
const secretKey = "wayfarer.playerSecret"
const existingIdentity = localStorage.getItem(identityKey)
const existingSecret = localStorage.getItem(secretKey)
const playerId = existingIdentity ?? crypto.randomUUID()
const playerSecret = existingSecret ?? crypto.randomUUID()
if (existingIdentity === null) localStorage.setItem(identityKey, playerId)
if (existingSecret === null) localStorage.setItem(secretKey, playerSecret)

export const gameSocket: Socket<ServerToClientEvents, ClientToServerEvents> =
	io({
		auth: { playerId, playerSecret },
	})

gameSocket.on("connect", () => {
	setState(connectionStateAtom, "connected")
	setState(actionErrorAtom, null)
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

gameSocket.on("disconnect", () => {
	setState(connectionStateAtom, "disconnected")
})

gameSocket.on("connect_error", (error) => {
	setState(connectionStateAtom, "disconnected")
	setState(actionErrorAtom, error.message)
})

gameSocket.on("roomClosed", (message) => {
	setState(actionErrorAtom, message)
	clearRoomSession()
})
