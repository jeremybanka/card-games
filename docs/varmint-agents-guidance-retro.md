# Feedback on Varmint's Agent Guidance

**Suggested email subject:** Practical feedback on Varmint's `AGENTS.md`

## Context

We recently adopted Varmint 0.5.19 for deterministic replay of AI model calls
in a multiplayer card-game application. The work included:

- compact natural-language prompts;
- paid model recordings;
- deterministic CI replay;
- readable fixture names;
- validation and fallback behavior around raw model output; and
- parallel local development with isolated runtime state.

Varmint ultimately worked well. It now replays complete model-backed games,
including an 80-call recording containing 20 bids and 60 card plays. It also
faithfully reproduces an invalid model action and the application's deterministic
fallback.

Most of our difficulties came from three design decisions that the current
`AGENTS.md` does not emphasize strongly enough:

1. choosing the correct function boundary;
2. defining the complete semantic identity of a fixture; and
3. controlling when fixtures may be read, written, or deleted.

This memo proposes documentation changes that would help other agents get those
decisions right sooner.

## What already works well

The existing guide establishes several useful principles:

- Varmint is a filesystem-backed deterministic replay mechanism.
- Fixtures are reviewable test artifacts rather than hidden mocks.
- `read` mode should fail on cache misses in CI.
- Pure in-process logic should usually be tested directly.
- Fixture changes deserve the same scrutiny as snapshot changes.

Those are strong foundations. The main opportunity is to make the failure modes
around boundaries, hidden configuration, and fixture lifecycle more explicit.

## Recommended changes

### 1. Explain that Varmint cannot see hidden semantic inputs

Varmint records and compares the wrapped function's explicit arguments. It
cannot detect relevant configuration captured by a closure or read elsewhere,
including:

- model identity;
- system instructions;
- output schemas;
- provider settings;
- endpoint or API versions;
- feature flags; and
- parser or prompt-template versions.

Two calls can therefore have identical explicit arguments while representing
different operations.

Suggested guidance:

> Varmint can only compare explicit call arguments. Configuration captured by a
> closure is invisible to it. If hidden configuration can change the result,
> either make a safe representation of it an explicit argument or include a
> deterministic fingerprint of the complete semantic contract in the fixture
> identity. Never include credentials in that fingerprint.

For our model calls, the semantic contract includes the model, rendered user
prompt, system prompt, structured-output contract, and provider reasoning
settings.

### 2. Recommend readable names plus semantic fingerprints

The current recommendation to prefer stable, human-readable keys is useful but
incomplete. Readable labels are good navigation aids; they are weak identities.

We found this pattern effective:

```text
round-2-trick-4-play-3-P1--a701b47efab7
```

The prefix explains the scenario. The suffix fingerprints the complete
generation contract.

Suggested guidance:

> Give each fixture a readable behavioral prefix followed by a deterministic
> fingerprint of its complete semantic input. The prefix makes fixtures easy to
> navigate; the fingerprint prevents collisions and makes contract changes
> produce visibly distinct cases.

The guide should also warn against hashing secrets and mention that filename
sanitization can collapse otherwise distinct human-readable names.

### 3. Do not recommend `read-write` as the general local default

`read-write` is convenient for cheap, disposable integrations. It is risky for
paid, rate-limited, side-effecting, or provenance-sensitive dependencies:

- a missing fixture silently causes a live call;
- ordinary test runs can unexpectedly spend money;
- a run can mix old cached results with new live results;
- accidental scenarios become durable fixtures; and
- provenance becomes difficult to establish.

We recommend `read` for ordinary local and CI tests, with `write` available only
through an explicitly named recording command:

```ts
import type { CacheMode } from "varmint"

export const VARMINT_MODE: CacheMode =
	process.env.CI === "true"
		? "read"
		: process.env.RECORD_FIXTURES === "1"
			? "write"
			: "read"
```

Recommended policy:

- `read` for ordinary local tests and CI;
- `write` for explicit fixture-maintenance commands;
- `off` for production and deliberate uncached exploration; and
- `read-write` only when silent live calls are cheap and acceptable.

### 4. Show how to select the correct wrapper boundary

The existing advice to wrap a process or service boundary is correct, but agents
would benefit from a concrete counterexample:

```ts
// Poor: records a large internal object, not the dependency-facing input.
cachedGenerateTurn(gameState)

// Better: records the actual value sent to the dependency.
cachedModelCall(renderPrompt(gameState))
```

Our first implementation recorded the game state used to construct a model
prompt. The fixtures were enormous and difficult to review, and they did not
directly show what the model received.

Suggested guidance:

> Record the stable value that actually crosses the external boundary, not an
> upstream application object that will later be transformed into that value.
> If fixture diffs are unexpectedly large, dominated by internal state, or
> difficult to interpret, the wrapper is probably too high in the stack.

For model calls, the usual reviewable input is the rendered prompt or a compact,
safe representation of the outbound generation request.

### 5. Distinguish raw output, guarded decisions, and committed actions

Varmint correctly cached a model response that selected an illegal card. The
application's legality guard rejected it and chose a deterministic fallback.
Cache replay reproduced the same invalid output and the same fallback.

That is valuable behavior, but it requires a clear layering model:

1. raw external result;
2. parsed and validated decision;
3. guarded fallback, if necessary; and
4. action accepted by the authoritative application.

Suggested guidance:

> Prefer caching the raw external result, then run parsing, validation, legality
> checks, retries, and fallbacks outside the cache. This lets replay exercise the
> application's handling of malformed or invalid dependency behavior.
>
> Do not assume that a cached output was accepted by the application. When the
> distinction matters, assert the raw result, guarded decision, and committed
> action separately.

Agents should not manually sanitize a fixture merely because the external
result is poor. Invalid outputs are often especially useful regression cases.

### 6. Explain the positional-argument input format

For a one-argument wrapped function, Varmint records:

```json
[
  "the prompt"
]
```

This can look like an accidental wrapper if the format is not explained.

Suggested guidance:

> `.input.json` contains the wrapped function's positional argument list. A
> one-argument function therefore produces `[value]`, not `value`. Avoid adding
> an unnecessary object such as `{ input: value }` solely for fixture
> formatting.

### 7. Strengthen source-control and provenance guidance

We initially had valid local fixtures under an ignored `.varmint` directory.
Local replay worked, but CI could not possibly access the recordings.

Suggested guidance:

> If CI uses `read`, verify that every required fixture is tracked rather than
> merely present locally. Inspect ignore rules, staged fixture counts, and the
> final committed paths.
>
> Keep durable replay evidence—inputs and outputs—tracked. Keep transient
> reports, costs, timestamps, assessments, and local diagnostic artifacts
> ignored unless the project explicitly treats them as golden data.

Fixture names also do not establish provenance. A test named "Sol versus Luna"
may still be running a deterministic fallback for every seat.

Suggested guidance:

> Scenario labels describe intended provenance; they do not prove that an
> external call occurred. Recording tests should separately count model calls,
> cache hits, fallbacks, and committed actions.

### 8. Restrict `flush` to authoritative, isolated runs

The current guide recommends using `flush` after a suite to remove untouched
fixtures. This is unsafe for filtered tests, parallel agents, or shared fixture
directories.

While evaluating this advice, we also found a destructive behavior in Varmint
0.5.19. Each call to `.for(subKey)` replaces the collection's touched-file set
with a new empty set. After touching `first`, `second`, and `third`, calling
`flush()` retained only `third` and deleted both files for the first two cases.
The implementation should accumulate touched subkeys for the lifetime of the
collection rather than resetting the set on each `.for(...)` call.

Varmint 0.5.20 fixes this defect. We verified the patch first against an
isolated cache, where all three touched cases survived and an injected stale
case was removed, then against the repository's authoritative replay suites.
The real global flush touched all 163 checked-in cases and removed none.

`flush()` also iterates only collection keys touched by the current `Squirrel`
instance, so it cannot discover and remove an entirely orphaned collection
directory.

Suggested replacement:

> Use `flush` only when the current run authoritatively enumerates the entire
> fixture collection, uses an isolated writable directory, and is not a filtered
> or concurrent test run. Never flush a shared collection from a partial test
> selection. After a Varmint upgrade that changes cleanup behavior, reproduce
> `flush()` against an isolated temporary cache before using it on tracked
> fixtures.

### 9. Prefer deterministic injection for application-owned nondeterminism

The current guide suggests using Varmint for dates, clocks, and random values.
We recommend making that secondary advice:

> Prefer seeded randomness, injected clocks, and deterministic identifiers when
> the nondeterminism is owned by the application. Use Varmint when the value
> genuinely crosses an external or otherwise difficult-to-control boundary.

Caching internal randomness can conceal domain-design and replay problems.

### 10. Add explicit concurrency guidance

Varmint writes shared filesystem state, so agents need a clear rule:

> Concurrent writers must not share a mutable fixture directory. Give parallel
> agents and test processes isolated cache roots unless the shared collection is
> intentionally read-only. Run deliberate recording jobs alone.

### 11. Preserve diagnostics before enforcing quality assertions

Our paid 80-call recording completed successfully, but the recorder asserted
that there were zero fallbacks before it wrote its transient analysis artifact.
One invalid model action caused the test to fail after the complete cache had
already been written. The fixtures were recoverable; the in-memory usage
metadata was not.

Suggested guidance:

> Persist sufficient recording diagnostics before enforcing quality assertions
> such as zero fallbacks. Fixture validity and model quality are separate
> questions. A faithfully reproduced fallback can still be a valid and valuable
> fixture.

### 12. Add an explicit secret and privacy warning

Because Varmint records exact arguments, a wrapped request containing
authorization headers, credentials, personal data, or hidden application state
can write that information to disk and eventually to source control.

Suggested guidance:

> Never pass credentials, authorization headers, secrets, or unnecessary
> private data through recorded arguments. Define a safe fixture boundary and
> inspect generated files before staging them. Semantic fingerprints must also
> exclude secrets.

## Proposed condensed guidance

The following could serve as a high-visibility checklist near the beginning of
`AGENTS.md`:

> Varmint is a deterministic function-call replay tool, not a general snapshot
> directory.
>
> - Wrap the exact external boundary.
> - Record explicit, safe semantic inputs rather than upstream application
>   state.
> - Remember that closure configuration is invisible to Varmint.
> - Use readable fixture names plus a complete-contract fingerprint.
> - Use strict `read` by default and explicit `write` recording commands.
> - Cache raw dependency output; validate and guard it outside the cache.
> - Distinguish raw output, fallback decisions, and committed actions.
> - Track the fixtures CI needs and ignore transient analysis.
> - Verify real-call provenance instead of inferring it from scenario names.
> - Never record secrets.
> - Never flush shared or partially enumerated fixture collections.
> - Isolate concurrent writers.

## Closing assessment

Varmint behaved consistently throughout our integration. The important lesson
is that its correctness depends on information and policy supplied by the
caller:

- It cannot invalidate a fixture for configuration it cannot see.
- It cannot distinguish a convenient label from a complete identity.
- It cannot decide whether a silent live call is acceptable.
- It cannot know whether a fixture directory is authoritative, shared, or
  transient.

Making those responsibilities explicit in `AGENTS.md` would help agents use
Varmint safely on their first attempt, particularly for paid model calls and
other high-cost external dependencies.
