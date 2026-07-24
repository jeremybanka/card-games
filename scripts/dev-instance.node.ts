import { spawn, type ChildProcess } from "node:child_process"
import { watch, type FSWatcher } from "node:fs"
import { createConnection, createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

const LOOPBACK_HOST = "127.0.0.1"
const PORT_READY_TIMEOUT_MS = 10_000

function instanceName(): string {
	const arguments_ = process.argv.slice(2)
	const nameArgumentIndex = arguments_.indexOf("--name")
	const requestedName =
		nameArgumentIndex === -1 ? arguments_[0] : arguments_[nameArgumentIndex + 1]
	return (
		requestedName?.trim() ||
		process.env.WAYFARER_DEV_NAME?.trim() ||
		`agent-${process.pid}`
	)
}

function slugify(input: string): string {
	const slug = input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
	return slug || "agent"
}

async function findAvailablePort(): Promise<number> {
	const probe = createServer()
	await new Promise<void>((resolveListen, rejectListen) => {
		probe.once("error", rejectListen)
		probe.listen(0, LOOPBACK_HOST, resolveListen)
	})
	const address = probe.address()
	if (address === null || typeof address === "string") {
		probe.close()
		throw new Error("Could not allocate a development port.")
	}
	const { port } = address
	await new Promise<void>((resolveClose, rejectClose) => {
		probe.close((error) => {
			if (error === undefined) resolveClose()
			else rejectClose(error)
		})
	})
	return port
}

async function waitForPort(port: number, child: ChildProcess): Promise<void> {
	const startedAt = Date.now()
	while (Date.now() - startedAt < PORT_READY_TIMEOUT_MS) {
		if (child.exitCode !== null) {
			throw new Error(
				`The room server exited with code ${child.exitCode} before listening.`,
			)
		}
		const connected = await new Promise<boolean>((resolveConnection) => {
			const socket = createConnection({ host: LOOPBACK_HOST, port })
			const finish = (result: boolean): void => {
				socket.removeAllListeners()
				socket.destroy()
				resolveConnection(result)
			}
			socket.once("connect", () => finish(true))
			socket.once("error", () => finish(false))
		})
		if (connected) return
		await new Promise((resolveWait) => setTimeout(resolveWait, 50))
	}
	throw new Error(`The room server did not listen on port ${port} in time.`)
}

function terminate(child: ChildProcess, signal: NodeJS.Signals): void {
	if (child.exitCode !== null || child.pid === undefined) return
	if (process.platform === "win32") {
		child.kill(signal)
		return
	}
	try {
		process.kill(-child.pid, signal)
	} catch {
		child.kill(signal)
	}
}

const name = instanceName()
const runtimeId = `${slugify(name)}-${process.pid}`
const runtimeDirectory = join(tmpdir(), "wayfarer.quest", runtimeId)
const serverPort = await findAvailablePort()
const commonEnvironment = {
	...process.env,
	VARMINT_CACHE_DIRECTORY:
		process.env.VARMINT_CACHE_DIRECTORY ?? join(runtimeDirectory, "varmint"),
}

let vite: ChildProcess | undefined
let stopping = false
let restartPending = false
let restartTimer: NodeJS.Timeout | undefined
let watchers: FSWatcher[] = []

function startRoomServer(): ChildProcess {
	const child = spawn(
		process.execPath,
		["--env-file-if-exists=.env", "server/main.node.ts"],
		{
			detached: process.platform !== "win32",
			env: {
				...commonEnvironment,
				PORT: String(serverPort),
			},
			stdio: "inherit",
		},
	)
	child.once("exit", (code, signal) => {
		if (stopping) return
		if (restartPending) {
			restartPending = false
			server = startRoomServer()
			return
		}
		console.error(
			`[dev:${name}] room server stopped (${signal ?? `exit ${code ?? 1}`}).`,
		)
		stop("SIGTERM", code ?? 1)
	})
	return child
}

let server = startRoomServer()

function scheduleRoomServerRestart(changedPath: string): void {
	if (stopping) return
	if (restartTimer !== undefined) clearTimeout(restartTimer)
	restartTimer = setTimeout(() => {
		restartTimer = undefined
		restartPending = true
		console.log(`[dev:${name}] restarting room server after ${changedPath}`)
		terminate(server, "SIGTERM")
	}, 75)
}

watchers = ["server", "src/ai", "src/game", "src/observability"].map(
	(watchPath) =>
		watch(watchPath, { recursive: true }, (_eventType, filename) =>
			scheduleRoomServerRestart(join(watchPath, filename ?? "")),
		),
)

function stop(signal: NodeJS.Signals, exitCode = 0): void {
	if (stopping) return
	stopping = true
	if (restartTimer !== undefined) clearTimeout(restartTimer)
	for (const watcher of watchers) watcher.close()
	terminate(server, signal)
	if (vite !== undefined) terminate(vite, signal)
	process.exitCode = exitCode
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.once(signal, () => stop(signal))
}

try {
	await waitForPort(serverPort, server)
	const clientPort = await findAvailablePort()
	vite = spawn(
		process.platform === "win32" ? "pnpm.cmd" : "pnpm",
		[
			"dev:vite",
			"--host",
			"0.0.0.0",
			"--port",
			String(clientPort),
			"--strictPort",
			"--configLoader",
			"runner",
		],
		{
			detached: process.platform !== "win32",
			env: {
				...commonEnvironment,
				WAYFARER_SERVER_PORT: String(serverPort),
				WAYFARER_VITE_CACHE_DIRECTORY: join(runtimeDirectory, "vite"),
			},
			stdio: "inherit",
		},
	)
	vite.once("exit", (code, signal) => {
		if (stopping) return
		console.error(
			`[dev:${name}] Vite stopped (${signal ?? `exit ${code ?? 1}`}).`,
		)
		stop("SIGTERM", code ?? 1)
	})
	console.log(
		[
			`[dev:${name}] isolated development instance`,
			`  app:    http://${LOOPBACK_HOST}:${clientPort}`,
			`  server: http://${LOOPBACK_HOST}:${serverPort}`,
			`  runtime: ${runtimeDirectory}`,
		].join("\n"),
	)
} catch (error) {
	console.error(`[dev:${name}] failed to start`, error)
	stop("SIGTERM", 1)
}
