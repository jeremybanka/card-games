import { describe, expect, it, vi } from "vitest"

import { type LogRecord, SpanLogger } from "./span-logger.node.ts"

describe("span logger", () => {
	it("correlates nested spans and records durations", async () => {
		const records: LogRecord[] = []
		const logger = new SpanLogger({
			service: "test",
			sink: (record) => records.push(record),
		})

		await logger.withRootSpan("room.action", { roomCode: "WIND" }, async () => {
			await logger.withSpan("ai.generate", { model: "gpt-5.6-terra" }, () => {
				logger.info("ai.decision", { action: "playCard" })
			})
		})

		const rootStart = records.find(
			(record) =>
				record.event === "span.start" && record.spanName === "room.action",
		)
		const childStart = records.find(
			(record) =>
				record.event === "span.start" && record.spanName === "ai.generate",
		)
		const childEnd = records.find(
			(record) =>
				record.event === "span.end" && record.spanName === "ai.generate",
		)
		expect(childStart?.traceId).toBe(rootStart?.traceId)
		expect(childStart?.parentSpanId).toBe(rootStart?.spanId)
		expect(childEnd).toMatchObject({ outcome: "ok" })
		expect(childEnd?.durationMs).toBeTypeOf("number")
	})

	it("retains privileged game facts while redacting credentials", async () => {
		const records: LogRecord[] = []
		const logger = new SpanLogger({
			service: "test",
			sink: (record) => records.push(record),
		})
		const queenOfSpades = { rank: 12, suit: "spades" }

		await logger.withRootSpan(
			"ai.turn",
			{
				cardValues: {
					"card::queen": queenOfSpades,
				},
				hand: [{ id: "card::queen", value: queenOfSpades }],
				openaiApiKey: "sk-this-is-a-secret-test-key",
				playerSecret: "device-secret",
				renderedFacts: "Private hand: queen of spades [card::queen]",
			},
			() => undefined,
		)

		const serialized = JSON.stringify(records)
		expect(serialized).toContain("queen of spades")
		expect(serialized).toContain("card::queen")
		expect(serialized).not.toContain("sk-this-is-a-secret-test-key")
		expect(serialized).not.toContain("device-secret")
		expect(serialized).toContain("[REDACTED]")
		expect(serialized).not.toContain("[CIRCULAR]")
	})

	it("marks thrown spans as errors without swallowing failures", async () => {
		const records: LogRecord[] = []
		const logger = new SpanLogger({
			service: "test",
			sink: (record) => records.push(record),
		})

		await expect(
			logger.withRootSpan("room.start", {}, () => {
				throw new Error("No players are ready.")
			}),
		).rejects.toThrow("No players are ready.")
		expect(records.at(-1)).toMatchObject({
			event: "span.end",
			outcome: "error",
		})
	})

	it("does not let a broken sink interrupt game work", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined)
		const logger = new SpanLogger({
			service: "test",
			sink: () => {
				throw new Error("Collector unavailable.")
			},
		})

		await expect(
			logger.withRootSpan("game.action", {}, () => "completed"),
		).resolves.toBe("completed")
		expect(consoleError).toHaveBeenCalled()
		consoleError.mockRestore()
	})
})
