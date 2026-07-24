import { describe, expect, it, vi } from "vitest"

import {
	createPrettyLogSink,
	formatPrettyLogRecord,
	type LogRecord,
	selectServerLogSink,
	SpanLogger,
} from "./span-logger.node.ts"

const representativeRecord: LogRecord = {
	attributes: {
		action: "playCard",
		cards: ["card::heart", "card::spade"],
		decision: { rank: 12, suit: "spades" },
	},
	durationMs: 18.25,
	event: "span.end",
	level: "info",
	outcome: "ok",
	parentSpanId: "parent-span-id",
	service: "wayfarer-hearts",
	spanId: "child-span-id",
	spanName: "ai.turn",
	timestamp: "2026-07-24T21:42:03.456Z",
	traceId: "trace-id-long",
}

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

	it("respects the configured minimum level", () => {
		vi.stubEnv("LOG_LEVEL", "warn")
		const records: LogRecord[] = []
		const logger = new SpanLogger({
			service: "test",
			sink: (record) => records.push(record),
		})

		logger.debug("debug.hidden")
		logger.info("info.hidden")
		logger.warn("warning.visible")
		logger.error("error.visible")

		expect(records.map((record) => record.event)).toEqual([
			"warning.visible",
			"error.visible",
		])
		vi.unstubAllEnvs()
	})
})

describe("pretty log formatting", () => {
	it("shows timestamp, level, service, outcome, duration, correlation, and nested attributes", () => {
		const formatted = formatPrettyLogRecord(representativeRecord, {
			color: false,
		})

		expect(formatted).toContain("21:42:03.456  INFO   wayfarer-hearts")
		expect(formatted).toContain("✓ ai.turn")
		expect(formatted).toContain("18.25ms")
		expect(formatted).toContain("trace=trace-id")
		expect(formatted).toContain("span=child-sp")
		expect(formatted).toContain("parent=parent-s")
		expect(formatted).toContain("action: 'playCard'")
		expect(formatted).toContain("decision:")
		expect(formatted).toContain("suit: 'spades'")
	})

	it("distinguishes starts, nested events, warnings, and failed spans", () => {
		const start = formatPrettyLogRecord(
			{
				event: "span.start",
				level: "info",
				service: "room",
				spanName: "room.action",
				timestamp: "2026-07-24T21:42:03.456Z",
			},
			{ color: false },
		)
		const nestedWarning = formatPrettyLogRecord(
			{
				event: "ai.strategy.fallback",
				level: "warn",
				parentSpanId: "parent",
				service: "room",
				spanName: "ai.turn",
				timestamp: "2026-07-24T21:42:03.456Z",
			},
			{ color: false },
		)
		const failure = formatPrettyLogRecord(
			{
				durationMs: 4.2,
				error: {
					message: "No legal card.",
					name: "Error",
					stack: "Error: No legal card.\n    at playCard",
				},
				event: "span.end",
				level: "error",
				outcome: "error",
				service: "room",
				spanName: "game.play",
				timestamp: "2026-07-24T21:42:03.456Z",
			},
			{ color: false },
		)

		expect(start).toContain("▶ room.action")
		expect(nestedWarning).toContain("WARN")
		expect(nestedWarning).toContain("↳ ai.strategy.fallback (ai.turn)")
		expect(failure).toContain("ERROR")
		expect(failure).toContain("✗ game.play")
		expect(failure).toContain("No legal card.")
		expect(failure).toContain("at playCard")
	})

	it("uses restrained ANSI colors unless color is disabled", () => {
		const colored = formatPrettyLogRecord(representativeRecord)
		const plain = formatPrettyLogRecord(representativeRecord, { color: false })

		expect(colored).toContain("\u001b[")
		expect(plain).not.toContain("\u001b[")
		expect(plain).toContain("✓ ai.turn")
	})

	it("clips very large privileged payloads while pointing to complete JSON", () => {
		const formatted = formatPrettyLogRecord(
			{
				attributes: {
					players: Array.from({ length: 30 }, (_, index) => ({
						cards: Array.from(
							{ length: 13 },
							(_card, cardIndex) => `card::${index}-${cardIndex}`,
						),
						name: `Player ${index}`,
					})),
				},
				event: "ai.state.updated",
				level: "info",
				service: "test",
				timestamp: "2026-07-24T21:42:03.456Z",
			},
			{ color: false },
		)

		expect(formatted).toContain("players:")
		expect(formatted).toContain("more lines")
		expect(formatted).toContain("LOG_FORMAT=json")
		expect(formatted.split("\n").length).toBeLessThanOrEqual(39)
	})

	it("keeps warning and error routing while sending other levels to stdout", () => {
		const target = {
			error: vi.fn(),
			log: vi.fn(),
			warn: vi.fn(),
		}
		const sink = createPrettyLogSink({ color: false, console: target })
		const base = {
			event: "example",
			service: "test",
			timestamp: "2026-07-24T21:42:03.456Z",
		}

		sink({ ...base, level: "debug" })
		sink({ ...base, level: "info" })
		sink({ ...base, level: "warn" })
		sink({ ...base, level: "error" })

		expect(target.log).toHaveBeenCalledTimes(2)
		expect(target.warn).toHaveBeenCalledTimes(1)
		expect(target.error).toHaveBeenCalledTimes(1)
		expect(target.warn.mock.calls[0]?.[0]).toContain("WARN")
		expect(target.error.mock.calls[0]?.[0]).toContain("ERROR")
	})

	it("selects pretty output only for local interactive terminals by default", () => {
		const target = {
			error: vi.fn(),
			log: vi.fn(),
			warn: vi.fn(),
		}
		const record: LogRecord = {
			event: "server.listening",
			level: "info",
			service: "test",
			timestamp: "2026-07-24T21:42:03.456Z",
		}
		const pretty = selectServerLogSink({
			console: target,
			environment: {},
			stderrIsTTY: true,
			stdoutIsTTY: true,
		})
		const piped = selectServerLogSink({
			environment: {},
			stderrIsTTY: false,
			stdoutIsTTY: false,
		})
		const production = selectServerLogSink({
			environment: { NODE_ENV: "production" },
			stderrIsTTY: true,
			stdoutIsTTY: true,
		})

		pretty(record)
		expect(target.log.mock.calls[0]?.[0]).toContain("server.listening")
		expect(target.log.mock.calls[0]?.[0]).not.toMatch(/^\{/)
		expect(piped).toBe(production)
	})

	it("honors explicit JSON, pretty, and standard color-disable settings", () => {
		const json = selectServerLogSink({
			environment: { LOG_FORMAT: "json" },
			stderrIsTTY: true,
			stdoutIsTTY: true,
		})
		const target = {
			error: vi.fn(),
			log: vi.fn(),
			warn: vi.fn(),
		}
		const pretty = selectServerLogSink({
			console: target,
			environment: { LOG_FORMAT: "pretty", NO_COLOR: "" },
			stderrIsTTY: false,
			stdoutIsTTY: false,
		})

		expect(json).toBe(
			selectServerLogSink({
				environment: { NODE_ENV: "production" },
				stderrIsTTY: false,
				stdoutIsTTY: false,
			}),
		)
		pretty(representativeRecord)
		expect(target.log.mock.calls[0]?.[0]).not.toContain("\u001b[")
	})

	it("keeps machine output as newline-delimited JSON", () => {
		const consoleLog = vi
			.spyOn(console, "log")
			.mockImplementation(() => undefined)
		const sink = selectServerLogSink({
			environment: { NODE_ENV: "production" },
			stderrIsTTY: true,
			stdoutIsTTY: true,
		})

		sink(representativeRecord)

		const line = consoleLog.mock.calls[0]?.[0]
		expect(line).toBeTypeOf("string")
		expect(JSON.parse(line as string)).toEqual(representativeRecord)
		consoleLog.mockRestore()
	})

	it("formats only records that have already crossed recursive redaction", () => {
		const output: string[] = []
		const logger = new SpanLogger({
			service: "test",
			sink: (record) =>
				output.push(formatPrettyLogRecord(record, { color: false })),
		})

		logger.warn("credentials.received", {
			authorization: "Bearer should-not-appear-anywhere",
			nested: {
				openaiApiKey: "sk-this-is-a-secret-test-key",
				privateHand: ["queen of spades"],
			},
		})

		expect(output.join("\n")).toContain("[REDACTED]")
		expect(output.join("\n")).toContain("queen of spades")
		expect(output.join("\n")).not.toContain("should-not-appear-anywhere")
		expect(output.join("\n")).not.toContain("sk-this-is-a-secret-test-key")
	})
})
