import { setState } from "atom.io"
import { useO } from "atom.io/react"
import type { VNode } from "preact"

import {
	actionErrorAtom,
	clearRoomSession,
	connectionStateAtom,
	playerNameInputAtom,
	roomCodeInputAtom,
	roomSessionAtom,
	saveRoomSession,
} from "./client-state.ts"
import { GameTable } from "./GameTable.tsx"
import { gameSocket } from "./game-socket.ts"
import css from "./AppShell.module.css"

export function AppShell(): VNode {
	const connectionState = useO(connectionStateAtom)
	const playerName = useO(playerNameInputAtom)
	const roomCode = useO(roomCodeInputAtom)
	const roomSession = useO(roomSessionAtom)
	const actionError = useO(actionErrorAtom)

	if (roomSession !== null) {
		return (
			<app-shell className={css.class}>
				<GameTable
					key={`${roomSession.roomCode}:${roomSession.generation}`}
					socket={gameSocket}
					onLeave={() => {
						gameSocket.emit("leaveRoom", () => {})
						clearRoomSession()
					}}
				/>
			</app-shell>
		)
	}

	const playerNameReady = playerName.trim().length > 0
	const roomCodeReady = /^[A-Za-z]{4}$/.test(roomCode)

	return (
		<app-shell className={css.class}>
			<lobby-screen>
				<lobby-card>
					<lobby-heading>
						<small>WAYFARER</small>
						<h1>Hearts</h1>
						<p>A private table for two to four players.</p>
					</lobby-heading>
					<form
						onSubmit={(event) => {
							event.preventDefault()
							if (!playerNameReady || !roomCodeReady) return
							setState(actionErrorAtom, null)
							gameSocket.emit("joinRoom", roomCode, playerName, (result) => {
								if (result.ok) {
									saveRoomSession(result.roomCode, playerName.trim())
								} else {
									setState(actionErrorAtom, result.error)
								}
							})
						}}
					>
						<label>
							<span>Your name</span>
							<input
								autocomplete="name"
								maxLength={18}
								placeholder="Ada"
								value={playerName}
								onInput={(event) => {
									setState(playerNameInputAtom, event.currentTarget.value)
								}}
							/>
						</label>
						<label>
							<span>Room code</span>
							<input
								autocapitalize="characters"
								maxLength={4}
								placeholder="WIND"
								value={roomCode}
								onInput={(event) => {
									setState(
										roomCodeInputAtom,
										event.currentTarget.value
											.toUpperCase()
											.replace(/[^A-Z]/g, ""),
									)
								}}
							/>
						</label>
						<action-row>
							<button
								type="button"
								disabled={!playerNameReady || connectionState !== "connected"}
								onClick={() => {
									setState(actionErrorAtom, null)
									gameSocket.emit("createRoom", playerName, (result) => {
										if (result.ok) {
											saveRoomSession(result.roomCode, playerName.trim())
										} else {
											setState(actionErrorAtom, result.error)
										}
									})
								}}
							>
								Create table
							</button>
							<button
								type="submit"
								disabled={
									!(
										playerNameReady &&
										roomCodeReady &&
										connectionState === "connected"
									)
								}
							>
								Join table
							</button>
						</action-row>
					</form>
					<lobby-status aria-live="polite">
						{actionError ??
							(connectionState === "connected"
								? "Ready to deal."
								: "Connecting to the table…")}
					</lobby-status>
				</lobby-card>
			</lobby-screen>
		</app-shell>
	)
}
