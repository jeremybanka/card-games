import { atom, getState, setState } from "atom.io"
import type { GameKind } from "./game/hearts-types.ts"

export type RoomSession = {
	generation: number
	playerName: string
	roomCode: string
}

function storedPlayerName(): string {
	return window.localStorage.getItem("wayfarer.playerName") ?? ""
}

function storedRoomSession(): RoomSession | null {
	const roomCode = window.localStorage.getItem("wayfarer.roomCode")
	const playerName = storedPlayerName()
	if (roomCode === null || playerName === "") return null
	return { generation: 0, playerName, roomCode }
}

export type ConnectionState =
	| "connected"
	| "connecting"
	| "disconnected"
	| "reconnected"
	| "reconnecting"

export const connectionStateAtom = atom<ConnectionState>({
	key: "connectionState",
	default: "connecting",
})

export const playerNameInputAtom = atom<string>({
	key: "playerNameInput",
	default: storedPlayerName(),
})

export const gameKindInputAtom = atom<GameKind>({
	key: "gameKindInput",
	default: "hearts",
})

export const roomCodeInputAtom = atom<string>({
	key: "roomCodeInput",
	default:
		new URL(window.location.href).searchParams.get("room")?.toUpperCase() ?? "",
})

export const roomSessionAtom = atom<RoomSession | null>({
	key: "roomSession",
	default: storedRoomSession(),
})

export const actionErrorAtom = atom<string | null>({
	key: "actionError",
	default: null,
})

export function saveRoomSession(roomCode: string, playerName: string): void {
	window.localStorage.setItem("wayfarer.playerName", playerName)
	window.localStorage.setItem("wayfarer.roomCode", roomCode)
	const url = new URL(window.location.href)
	url.searchParams.set("room", roomCode)
	history.replaceState(null, "", url)
	setState(roomSessionAtom, {
		generation: (getState(roomSessionAtom)?.generation ?? 0) + 1,
		playerName,
		roomCode,
	})
}

export function clearRoomSession(): void {
	window.localStorage.removeItem("wayfarer.roomCode")
	const url = new URL(window.location.href)
	url.searchParams.delete("room")
	history.replaceState(null, "", url)
	setState(roomSessionAtom, null)
}
