import preact from "@preact/preset-vite"
import { defineConfig } from "vite-plus"

export default defineConfig({
	plugins: process.env.NODE_ENV === "test" ? [] : [...preact()],
	server: {
		proxy: {
			"/socket.io": {
				target: "http://127.0.0.1:8787",
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
