// @vitest-environment happy-dom

import { cleanup, render, screen, within } from "@testing-library/react"
import { createElement, type FunctionComponent } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ScorecardLockup } from "./ScorecardLockup.tsx"

vi.mock("preact/jsx-runtime", async () => {
	const runtime = await vi.importActual<object>("react/jsx-runtime")
	const developmentRuntime = await vi.importActual<object>(
		"react/jsx-dev-runtime",
	)
	return { ...runtime, ...developmentRuntime }
})

afterEach(cleanup)

const ScorecardLockupCompat = ScorecardLockup as unknown as FunctionComponent<
	Parameters<typeof ScorecardLockup>[0]
>

describe("ScorecardLockup", () => {
	it.each([
		{ points: 0, tricks: 0 },
		{ points: 26, tricks: 13 },
	])("labels $tricks tricks and $points points", ({ points, tricks }) => {
		render(createElement(ScorecardLockupCompat, { points, tricks }))

		const lockup = screen.getByLabelText(`${tricks} tricks, ${points} points`)
		const counters = lockup.querySelectorAll("score-counter")

		expect(counters).toHaveLength(2)
		expect(
			within(counters[0] as HTMLElement).getByText("Tricks"),
		).not.toBeNull()
		expect(
			within(counters[0] as HTMLElement).getByText(String(tricks)),
		).not.toBeNull()
		expect(
			within(counters[1] as HTMLElement).getByText("Points"),
		).not.toBeNull()
		expect(
			within(counters[1] as HTMLElement).getByText(String(points)),
		).not.toBeNull()
	})

	it("uses singular accessible labels", () => {
		render(createElement(ScorecardLockupCompat, { points: 1, tricks: 1 }))

		expect(screen.getByLabelText("1 trick, 1 point")).not.toBeNull()
	})

	it("adds a persistent Oh Hell bid counter without changing Hearts", () => {
		const { rerender } = render(
			createElement(ScorecardLockupCompat, {
				bid: null,
				points: 17,
				tricks: 2,
			}),
		)

		expect(screen.getByLabelText("2 tricks, no bid, 17 points")).not.toBeNull()
		expect(screen.getByText("Bid")).not.toBeNull()
		expect(screen.getByText("—")).not.toBeNull()

		rerender(
			createElement(ScorecardLockupCompat, {
				bid: 3,
				points: 17,
				tricks: 2,
			}),
		)
		expect(screen.getByLabelText("2 tricks, 3 bid, 17 points")).not.toBeNull()
		expect(screen.getByText("3")).not.toBeNull()
	})
})
