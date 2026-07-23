import "./globals.css"

import { RealtimeProvider } from "atom.io/realtime-react"
import {
	createElement,
	render,
	type ComponentChildren,
	type FunctionComponent,
} from "preact"

import { AppShell } from "./AppShell.tsx"
import { gameSocket } from "./game-socket.ts"

const appRoot = document.getElementById("app")

if (appRoot === null) {
	throw new Error("Expected the app root to exist.")
}

const RealtimeProviderCompat =
	RealtimeProvider as unknown as FunctionComponent<{
		children?: ComponentChildren
		socket: typeof gameSocket
	}>

render(
	createElement(
		RealtimeProviderCompat,
		{ socket: gameSocket },
		createElement(AppShell, {}),
	),
	appRoot,
)
