import preact from "@preact/preset-vite"
import { defineConfig } from "vite-plus"

const roomServerPort = process.env.WAYFARER_SERVER_PORT ?? "8787"
const roomServerHost = "eris.local"

export default defineConfig({
	...(process.env.WAYFARER_VITE_CACHE_DIRECTORY === undefined
		? {}
		: { cacheDir: process.env.WAYFARER_VITE_CACHE_DIRECTORY }),
	plugins: process.env.NODE_ENV === "test" ? [] : [...preact()],
	server: {
		allowedHosts: [roomServerHost],
		proxy: {
			"/socket.io": {
				target: `http://${roomServerHost}:${roomServerPort}`,
				ws: true,
			},
		},
	},
	lint: {
		ignorePatterns: ["**/dist/**", "**/node_modules/**"],
	},
	staged: {
		"*": ["dprint fmt", "vp check --no-fmt --fix"],
	},
	test: {
		include: ["src/**/*.test.ts"],
	},
})
