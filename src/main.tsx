import "./globals.css"

import { render } from "preact"

import { AppShell } from "./AppShell.tsx"

const appRoot = document.getElementById("app")

if (appRoot === null) {
	throw new Error("Expected the app root to exist.")
}

render(<AppShell />, appRoot)
