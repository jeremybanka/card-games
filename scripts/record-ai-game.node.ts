import { spawn } from "node:child_process"

const child = spawn(
	"vp",
	[
		"test",
		"--run",
		"src/ai/ai-game.e2e.test.ts",
		"--testNamePattern",
		"records a real",
	],
	{
		env: {
			...process.env,
			RECORD_LIVE_AI_GAME: "1",
		},
		stdio: "inherit",
	},
)

child.once("error", (error) => {
	console.error(error)
	process.exitCode = 1
})
child.once("exit", (code, signal) => {
	if (signal !== null) {
		console.error(`Live AI recording stopped by ${signal}.`)
		process.exitCode = 1
		return
	}
	process.exitCode = code ?? 1
})
