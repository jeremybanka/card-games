import { atom, getState, setState } from "atom.io"

export type RoomSession = {
	generation: number
	playerName: string
	roomCode: string
}

function storedPlayerName(): string {
	return localStorage.getItem("wayfarer.playerName") ?? ""
}

function storedRoomSession(): RoomSession | null {
	const roomCode = localStorage.getItem("wayfarer.roomCode")
	const playerName = storedPlayerName()
	if (roomCode === null || playerName === "") return null
	return { generation: 0, playerName, roomCode }
}

export const connectionStateAtom = atom<
	"connected" | "connecting" | "disconnected"
>({
	key: "connectionState",
	default: "connecting",
})

export const playerNameInputAtom = atom<string>({
	key: "playerNameInput",
	default: storedPlayerName(),
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
	localStorage.setItem("wayfarer.playerName", playerName)
	localStorage.setItem("wayfarer.roomCode", roomCode)
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
	localStorage.removeItem("wayfarer.roomCode")
	const url = new URL(window.location.href)
	url.searchParams.delete("room")
	history.replaceState(null, "", url)
	setState(roomSessionAtom, null)
}
