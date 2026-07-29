import { setState } from "atom.io"
import { useO } from "atom.io/react"
import type { VNode } from "preact"

import {
	actionErrorAtom,
	clearRoomSession,
	connectionStateAtom,
	gameKindInputAtom,
	playerNameInputAtom,
	roomCodeInputAtom,
	roomSessionAtom,
	saveRoomSession,
} from "./client-state.ts"
import {
	connectionActionsEnabled,
	connectionStatusMessage,
} from "./connection-status.ts"
import { GameTable } from "./GameTable.tsx"
import { gameSocket } from "./game-socket.ts"
import { gameCatalog, isGameKind } from "./game/game-catalog.ts"
import { GAME_KINDS } from "./game/game-kinds.ts"
import css from "./AppShell.module.css"

export function AppShell(): VNode {
	const connectionState = useO(connectionStateAtom)
	const playerName = useO(playerNameInputAtom)
	const gameKind = useO(gameKindInputAtom)
	const roomCode = useO(roomCodeInputAtom)
	const roomSession = useO(roomSessionAtom)
	const actionError = useO(actionErrorAtom)
	const connectionMessage = connectionStatusMessage(connectionState)

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
				{connectionMessage === null ? null : (
					<connection-status
						data-state={connectionState}
						role="status"
						aria-live="polite"
					>
						{connectionMessage}
					</connection-status>
				)}
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
						<h1>Card Games</h1>
						<p>A private table for Hearts or Oh Hell.</p>
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
							<span>Game</span>
							<select
								aria-label="Game"
								value={gameKind}
								onInput={(event) => {
									const nextGameKind = event.currentTarget.value
									if (isGameKind(nextGameKind)) {
										setState(gameKindInputAtom, nextGameKind)
									}
								}}
							>
								{GAME_KINDS.map((kind) => (
									<option key={kind} value={kind}>
										{gameCatalog[kind].label}
									</option>
								))}
							</select>
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
								disabled={
									!playerNameReady || !connectionActionsEnabled(connectionState)
								}
								onClick={() => {
									setState(actionErrorAtom, null)
									gameSocket.emit(
										"createRoom",
										playerName,
										gameKind,
										(result) => {
											if (result.ok) {
												saveRoomSession(result.roomCode, playerName.trim())
											} else {
												setState(actionErrorAtom, result.error)
											}
										},
									)
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
										connectionActionsEnabled(connectionState)
									)
								}
							>
								Join table
							</button>
						</action-row>
					</form>
					<lobby-status role="status" aria-live="polite">
						{connectionMessage ?? "Ready to deal."}
					</lobby-status>
					{actionError === null ? null : (
						<lobby-error role="alert">{actionError}</lobby-error>
					)}
				</lobby-card>
			</lobby-screen>
		</app-shell>
	)
}
