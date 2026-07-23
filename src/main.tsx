import "./globals.css"

import { RealtimeProvider } from "atom.io/realtime-react"
import { render } from "preact"

import { AppShell } from "./AppShell.tsx"
import { gameSocket } from "./game-socket.ts"

const appRoot = document.getElementById("app")

if (appRoot === null) {
	throw new Error("Expected the app root to exist.")
}

render(
	<RealtimeProvider socket={gameSocket}>
		<AppShell />
	</RealtimeProvider>,
	appRoot,
)
