import { AsyncLocalStorage } from "node:async_hooks"
import { randomUUID } from "node:crypto"
import { inspect } from "node:util"

export type LogLevel = "debug" | "error" | "info" | "warn"
export type LogFields = Record<string, unknown>
export type SpanOutcome = "error" | "ok"

export type LogRecord = {
	attributes?: LogFields
	durationMs?: number
	error?: unknown
	event: string
	level: LogLevel
	outcome?: SpanOutcome
	parentSpanId?: string
	service: string
	spanId?: string
	spanName?: string
	timestamp: string
	traceId?: string
}

export type LogSink = (record: LogRecord) => void

type SpanContext = {
	parentSpanId?: string
	spanId: string
	traceId: string
}

const credentialKeys = new Set([
	"accesstoken",
	"apikey",
	"authorization",
	"cookie",
	"openaikey",
	"openaiapikey",
	"password",
	"playersecret",
	"refreshtoken",
	"secret",
	"setcookie",
	"token",
])

const levelPriority: Record<LogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
}

function configuredLogLevel(): LogLevel {
	const value = process.env.LOG_LEVEL?.toLowerCase()
	if (value === "debug" || value === "warn" || value === "error") return value
	return "info"
}

function redactedString(value: string): string {
	return value
		.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_API_KEY]")
		.replace(/\bBearer\s+[A-Za-z0-9._~-]{12,}\b/gi, "Bearer [REDACTED]")
}

function safeValue(
	value: unknown,
	key: string,
	seen: WeakSet<object>,
): unknown {
	const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "")
	if (credentialKeys.has(normalizedKey)) return "[REDACTED]"
	if (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "number"
	) {
		return value
	}
	if (typeof value === "string") return redactedString(value)
	if (typeof value === "bigint") return value.toString()
	if (typeof value === "undefined") return undefined
	if (typeof value === "function" || typeof value === "symbol") {
		return String(value)
	}
	if (value instanceof Error) {
		return {
			message: redactedString(value.message),
			name: value.name,
			stack:
				value.stack === undefined ? undefined : redactedString(value.stack),
		}
	}
	if (typeof value !== "object") return String(value)
	if (seen.has(value)) return "[CIRCULAR]"
	seen.add(value)
	if (Array.isArray(value)) {
		const safeArray = value.map((entry) => safeValue(entry, "", seen))
		seen.delete(value)
		return safeArray
	}
	const safeObject: Record<string, unknown> = {}
	for (const [entryKey, entryValue] of Object.entries(value)) {
		const safeEntry = safeValue(entryValue, entryKey, seen)
		if (safeEntry !== undefined) safeObject[entryKey] = safeEntry
	}
	seen.delete(value)
	return safeObject
}

function safeFields(fields: LogFields): LogFields {
	return safeValue(fields, "", new WeakSet()) as LogFields
}

export function consoleSink(record: LogRecord): void {
	const line = JSON.stringify(record)
	if (record.level === "error") {
		console.error(line)
		return
	}
	if (record.level === "warn") {
		console.warn(line)
		return
	}
	console.log(line)
}

type LogConsole = Pick<Console, "error" | "log" | "warn">

type PrettyLogOptions = {
	color?: boolean
	console?: LogConsole
}

type LogSinkSelectionOptions = {
	console?: LogConsole
	environment?: NodeJS.ProcessEnv
	stderrIsTTY?: boolean
	stdoutIsTTY?: boolean
}

const ANSI = {
	bold: "\u001b[1m",
	cyan: "\u001b[36m",
	dim: "\u001b[2m",
	gray: "\u001b[90m",
	green: "\u001b[32m",
	magenta: "\u001b[35m",
	red: "\u001b[31m",
	reset: "\u001b[0m",
	yellow: "\u001b[33m",
}
const MAX_DETAIL_LINES = 36

function paint(value: string, color: string, enabled: boolean): string {
	return enabled ? `${color}${value}${ANSI.reset}` : value
}

function shortId(value: string | undefined): string | undefined {
	return value?.slice(0, 8)
}

function terminalColorEnabled(environment: NodeJS.ProcessEnv): boolean {
	if ("NO_COLOR" in environment || environment.FORCE_COLOR === "0") return false
	return true
}

function prettyValue(value: unknown, color: boolean): string {
	return inspect(value, {
		breakLength: 92,
		colors: color,
		compact: 2,
		depth: null,
		maxArrayLength: 40,
		maxStringLength: 500,
		sorted: true,
	})
}

function indentedDetails(
	label: string,
	value: unknown,
	color: boolean,
): string {
	const rendered = prettyValue(value, color)
	const lines = rendered.split("\n")
	if (lines.length === 1) return `${label}=${rendered}`
	const visibleLines = lines.slice(0, MAX_DETAIL_LINES)
	const omittedLineCount = lines.length - visibleLines.length
	const omission =
		omittedLineCount === 0
			? []
			: [
					paint(
						`… ${omittedLineCount} more lines; use LOG_FORMAT=json for the complete record`,
						ANSI.dim,
						color,
					),
				]
	return `${label}=\n${[...visibleLines, ...omission]
		.map((line) => `    ${line}`)
		.join("\n")}`
}

function displayName(record: LogRecord, color: boolean): string {
	if (record.event === "span.start" && record.spanName !== undefined) {
		return `${paint("▶", ANSI.magenta, color)} ${paint(
			record.spanName,
			ANSI.bold,
			color,
		)}`
	}
	if (record.event === "span.end" && record.spanName !== undefined) {
		const failed = record.outcome === "error"
		const symbol = failed ? "✗" : "✓"
		const outcomeColor = failed ? ANSI.red : ANSI.green
		return `${paint(symbol, outcomeColor, color)} ${paint(
			record.spanName,
			outcomeColor,
			color,
		)}`
	}
	const nesting = record.parentSpanId === undefined ? "•" : "↳"
	const spanContext =
		record.spanName === undefined
			? ""
			: paint(` (${record.spanName})`, ANSI.dim, color)
	return `${paint(nesting, ANSI.cyan, color)} ${record.event}${spanContext}`
}

export function formatPrettyLogRecord(
	record: LogRecord,
	options: { color?: boolean } = {},
): string {
	const color = options.color ?? true
	const timestamp = Number.isNaN(Date.parse(record.timestamp))
		? record.timestamp
		: record.timestamp.slice(11, 23)
	const levelColor =
		record.level === "error"
			? ANSI.red
			: record.level === "warn"
				? ANSI.yellow
				: record.level === "debug"
					? ANSI.gray
					: ANSI.cyan
	const level = record.level.toUpperCase().padEnd(5)
	const correlation = [
		shortId(record.traceId) === undefined
			? undefined
			: `trace=${shortId(record.traceId)}`,
		shortId(record.spanId) === undefined
			? undefined
			: `span=${shortId(record.spanId)}`,
		shortId(record.parentSpanId) === undefined
			? undefined
			: `parent=${shortId(record.parentSpanId)}`,
	]
		.filter((value) => value !== undefined)
		.join(" ")
	const summary = [
		paint(timestamp, ANSI.gray, color),
		paint(level, levelColor, color),
		paint(record.service, ANSI.cyan, color),
		displayName(record, color),
		record.durationMs === undefined
			? undefined
			: paint(`${record.durationMs.toFixed(2)}ms`, ANSI.magenta, color),
		correlation === "" ? undefined : paint(correlation, ANSI.dim, color),
	]
		.filter((value) => value !== undefined)
		.join("  ")
	const details = [
		record.attributes === undefined
			? undefined
			: indentedDetails("attributes", record.attributes, color),
		record.error === undefined
			? undefined
			: indentedDetails("error", record.error, color),
	]
		.filter((value) => value !== undefined)
		.join("\n")
	return details === ""
		? summary
		: `${summary}\n  ${details.replaceAll("\n", "\n  ")}`
}

export function createPrettyLogSink(options: PrettyLogOptions = {}): LogSink {
	const targetConsole = options.console ?? console
	const color = options.color ?? terminalColorEnabled(process.env)
	return (record) => {
		const line = formatPrettyLogRecord(record, { color })
		if (record.level === "error") {
			targetConsole.error(line)
			return
		}
		if (record.level === "warn") {
			targetConsole.warn(line)
			return
		}
		targetConsole.log(line)
	}
}

export function selectServerLogSink(
	options: LogSinkSelectionOptions = {},
): LogSink {
	const environment = options.environment ?? process.env
	const format = environment.LOG_FORMAT?.toLowerCase()
	const interactive =
		(options.stdoutIsTTY ?? Boolean(process.stdout.isTTY)) &&
		(options.stderrIsTTY ?? Boolean(process.stderr.isTTY))
	const usePretty =
		format === "pretty" ||
		(format !== "json" && environment.NODE_ENV !== "production" && interactive)
	if (!usePretty) return consoleSink
	return createPrettyLogSink({
		color: interactive && terminalColorEnabled(environment),
		...(options.console === undefined ? {} : { console: options.console }),
	})
}

export class ActiveSpan {
	readonly context: SpanContext
	readonly name: string
	readonly startedAt: number
	#attributes: LogFields
	#logger: SpanLogger
	#outcome: SpanOutcome = "ok"

	constructor(
		logger: SpanLogger,
		name: string,
		context: SpanContext,
		attributes: LogFields,
	) {
		this.#attributes = attributes
		this.#logger = logger
		this.context = context
		this.name = name
		this.startedAt = performance.now()
	}

	event(
		event: string,
		attributes: LogFields = {},
		level: LogLevel = "info",
	): void {
		this.#logger.write(level, event, attributes, this.context, this.name)
	}

	setAttributes(attributes: LogFields): void {
		Object.assign(this.#attributes, attributes)
	}

	setOutcome(outcome: SpanOutcome): void {
		this.#outcome = outcome
	}

	finish(error?: unknown): void {
		if (error !== undefined) this.#outcome = "error"
		this.#logger.write(
			this.#outcome === "error" ? "error" : "info",
			"span.end",
			{
				attributes: this.#attributes,
				durationMs:
					Math.round((performance.now() - this.startedAt) * 100) / 100,
				error,
				outcome: this.#outcome,
			},
			this.context,
			this.name,
		)
	}
}

export class SpanLogger {
	readonly service: string
	#minimumLevel: LogLevel
	#sink: LogSink
	#storage = new AsyncLocalStorage<SpanContext>()

	constructor(options: {
		minimumLevel?: LogLevel
		service: string
		sink?: LogSink
	}) {
		this.#minimumLevel = options.minimumLevel ?? configuredLogLevel()
		this.#sink = options.sink ?? consoleSink
		this.service = options.service
	}

	debug(event: string, attributes: LogFields = {}): void {
		this.write("debug", event, attributes, this.#storage.getStore())
	}

	error(event: string, attributes: LogFields = {}): void {
		this.write("error", event, attributes, this.#storage.getStore())
	}

	info(event: string, attributes: LogFields = {}): void {
		this.write("info", event, attributes, this.#storage.getStore())
	}

	getMinimumLevel(): LogLevel {
		return this.#minimumLevel
	}

	setMinimumLevel(level: LogLevel): void {
		this.#minimumLevel = level
	}

	warn(event: string, attributes: LogFields = {}): void {
		this.write("warn", event, attributes, this.#storage.getStore())
	}

	async withRootSpan<T>(
		name: string,
		attributes: LogFields,
		run: (span: ActiveSpan) => Promise<T> | T,
	): Promise<T> {
		return this.runSpan(name, attributes, run, true)
	}

	async withSpan<T>(
		name: string,
		attributes: LogFields,
		run: (span: ActiveSpan) => Promise<T> | T,
	): Promise<T> {
		return this.runSpan(name, attributes, run, false)
	}

	write(
		level: LogLevel,
		event: string,
		fields: LogFields,
		context: SpanContext | undefined,
		spanName?: string,
	): void {
		if (levelPriority[level] < levelPriority[this.#minimumLevel]) return
		const safe = safeFields(fields)
		const record: LogRecord = {
			event,
			level,
			service: this.service,
			timestamp: new Date().toISOString(),
		}
		if (context !== undefined) {
			record.traceId = context.traceId
			record.spanId = context.spanId
			if (context.parentSpanId !== undefined) {
				record.parentSpanId = context.parentSpanId
			}
		}
		if (spanName !== undefined) record.spanName = spanName
		if (safe.attributes !== undefined) {
			record.attributes = safe.attributes as LogFields
		} else {
			const recordAttributes = Object.fromEntries(
				Object.entries(safe).filter(
					([key]) =>
						key !== "durationMs" && key !== "error" && key !== "outcome",
				),
			)
			if (Object.keys(recordAttributes).length > 0) {
				record.attributes = recordAttributes
			}
		}
		if (typeof safe.durationMs === "number") {
			record.durationMs = safe.durationMs
		}
		if (safe.error !== undefined) record.error = safe.error
		if (safe.outcome === "ok" || safe.outcome === "error") {
			record.outcome = safe.outcome
		}
		try {
			this.#sink(record)
		} catch (error) {
			if (this.#sink !== consoleSink) {
				try {
					consoleSink({
						error: safeValue(error, "", new WeakSet()),
						event: "logger.sink_failed",
						level: "error",
						service: this.service,
						timestamp: new Date().toISOString(),
					})
				} catch {
					// Observability must never interrupt authoritative game work.
				}
			}
		}
	}

	private async runSpan<T>(
		name: string,
		attributes: LogFields,
		run: (span: ActiveSpan) => Promise<T> | T,
		root: boolean,
	): Promise<T> {
		const parent = root ? undefined : this.#storage.getStore()
		const context: SpanContext = {
			...(parent === undefined ? {} : { parentSpanId: parent.spanId }),
			spanId: randomUUID(),
			traceId: parent?.traceId ?? randomUUID(),
		}
		const span = new ActiveSpan(this, name, context, { ...attributes })
		this.write("info", "span.start", attributes, context, name)
		return this.#storage.run(context, async () => {
			try {
				const result = await run(span)
				span.finish()
				return result
			} catch (error) {
				span.finish(error)
				throw error
			}
		})
	}
}

export const serverLogger = new SpanLogger({
	service: "wayfarer-hearts",
	sink: selectServerLogSink(),
})
