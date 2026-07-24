// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react"
import { createElement, type FunctionComponent } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { PublicPlayerView } from "./game/hearts-types.ts"
import { playerInitials } from "./player-avatar.ts"
import { PlayerAvatar } from "./PlayerAvatar.tsx"
import { PlayerNameplate } from "./PlayerNameplate.tsx"

vi.mock("preact/jsx-runtime", async () => {
	const runtime = await vi.importActual<object>("react/jsx-runtime")
	const developmentRuntime = await vi.importActual<object>(
		"react/jsx-dev-runtime",
	)
	return { ...runtime, ...developmentRuntime }
})

afterEach(cleanup)

const aiPlayer = {
	aiModel: "gpt-5.6-terra",
	capturedCardIds: [],
	connected: true,
	handCardIds: [],
	id: "user::identity-ai",
	kind: "ai",
	name: "Sparkly Deathlord",
	roundPoints: 0,
	score: 13,
} satisfies PublicPlayerView

const PlayerAvatarCompat = PlayerAvatar as unknown as FunctionComponent<
	Parameters<typeof PlayerAvatar>[0]
>
const PlayerNameplateCompat = PlayerNameplate as unknown as FunctionComponent<
	Parameters<typeof PlayerNameplate>[0]
>

function renderNameplate(
	properties: Partial<Parameters<typeof PlayerNameplate>[0]> = {},
): void {
	render(
		createElement(PlayerNameplateCompat, {
			meta: "13 pts",
			player: aiPlayer,
			seatIndex: 2,
			...properties,
		}),
	)
}

describe("player identity", () => {
	it("derives stable initials from one- and multi-word names", () => {
		expect(playerInitials("Sandman")).toBe("S")
		expect(playerInitials("  Sparkly   Deathlord ")).toBe("SD")
	})

	it("renders an accessible, semantic AI badge independently of the name", () => {
		renderNameplate()

		expect(screen.getByText("Sparkly Deathlord").getAttribute("title")).toBe(
			"Sparkly Deathlord",
		)
		expect(screen.getByLabelText("AI player").textContent).toBe("AI")
		expect(screen.getByText("13 pts")).not.toBeNull()
		expect(screen.getByText("SD").getAttribute("aria-hidden")).toBe("true")
	})

	it("does not tag human players as AI", () => {
		renderNameplate({
			player: {
				...aiPlayer,
				aiModel: null,
				kind: "human",
				name: "Rook",
			},
		})

		expect(screen.queryByLabelText("AI player")).toBeNull()
	})

	it("labels a standalone avatar with its owner", () => {
		render(
			createElement(PlayerAvatarCompat, {
				name: "Pouting War Hog",
				seatIndex: 3,
			}),
		)

		expect(screen.getByLabelText("Pouting War Hog's avatar").textContent).toBe(
			"PW",
		)
	})
})
