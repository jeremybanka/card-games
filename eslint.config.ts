import parser from "@typescript-eslint/parser"
import atomIO from "atom.io/eslint-plugin"
import { defineConfig } from "eslint/config"
import lasertag from "lasertag/eslint-plugin"

export default defineConfig(
	{
		ignores: ["coverage/**", "dist/**", "node_modules/**"],
	},
	{
		files: ["src/**/*.{ts,tsx}"],
		languageOptions: {
			parser,
			parserOptions: {
				projectService: true,
				tsconfigRootDir: new URL(".", import.meta.url).pathname,
			},
		},
		plugins: {
			"atom.io": atomIO,
		},
		rules: {
			"atom.io/exact-catch-types": "error",
			"atom.io/explicit-state-types": "error",
			"atom.io/explicit-transaction-types": "error",
			"atom.io/naming-convention": "error",
		},
	},
	{
		files: ["src/**/*.tsx"],
		plugins: {
			lasertag,
		},
		rules: {
			"lasertag/access-css-module-class-only": "error",
			"lasertag/ban-div": "error",
			"lasertag/export-own-component-only": "error",
			"lasertag/header-main-footer-as-group": "error",
			"lasertag/import-own-css-module-only": "error",
			"lasertag/name-imported-css-module-as-css": "error",
			"lasertag/render-tag-with-own-name": [
				"error",
				{ checkAllComponentFunctions: true },
			],
		},
	},
)
