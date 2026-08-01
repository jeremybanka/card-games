# Wayfarer Hearts

A mobile-first, realtime multiplayer implementation of the classic trick-taking
game Hearts. One table supports two, three, or four players.

The client is a single [Vite](https://vite.dev/) application built with
[Preact](https://preactjs.com/). The room server uses
[atom.io](https://atom.io.fyi/) realtime projections over Socket.IO, and
[Lasertag](https://github.com/jeremybanka/lasertag) keeps component CSS aligned
with rendered structure.

## Start

Install the pinned toolchain and dependencies, then run the client and room
server together:

```sh
mise install
pnpm install
pnpm dev
```

Each `pnpm dev` invocation automatically receives its own client and room-server
ports, browser origin, and temporary Vite and AI cache directories. This lets
multiple agents run the application concurrently without sharing rooms, browser
identities, or mutable development caches. Give an instance a recognizable
label when several are running:

```sh
pnpm dev -- --name card-motion
pnpm dev -- --name ai-names
```

The launcher prints the isolated client URL for that instance and shuts down
both processes together. `WAYFARER_DEV_NAME=card-motion pnpm dev` is equivalent.
An explicitly supplied `VARMINT_CACHE_DIRECTORY` is preserved for work that
intentionally uses a shared recording; otherwise the launcher allocates an
instance-specific directory.

Open the Vite URL on two to four devices or browser profiles. One player creates
a table and shares its four-letter room code; the others join with that code.

## AI seats

Before dealing, the room owner can fill open seats with GPT-5.6 Sol, Terra, or
Luna opponents. Terra is the balanced default; Sol prioritizes strategic
quality, and Luna prioritizes speed and cost.

Copy `.env.example` to `.env` and set `OPENAI_API_KEY` to enable model-generated
strategy. Without a key, AI seats remain fully playable through the deterministic
strategic fallback. `VARMINT_CACHE_MODE` can be set to `read`, `write`, or
`read-write` when recording or replaying generator results; it defaults to
`off`. `VARMINT_CACHE_DIRECTORY` overrides the default
`.varmint/hearts-ai` fixture location. Varmint fixtures are committed so cache
inputs and model outputs remain reviewable.

Every AI is a separate Socket.IO player. It receives the same public projection
and one private hand projection through atom.io realtime, stores them in its own
private atom.io Silo, and submits the same schema-validated intents as a human.
The Silo maintains:

- accessible text facts that omit opponent card identities and hidden values;
- a private turn-by-turn observation journal;
- current-plan and next-action atoms;
- Loadable model-generated observation, plan, and action selectors.

Structured generation uses the Vercel AI SDK OpenAI provider and ArkType schemas,
with Varmint wrapping the data generator. Invalid or stale model actions fall
back to a deterministic legal strategy and are still validated by the
authoritative room server.

## Deterministic replay

Game randomness runs through a seeded linear congruential generator (LCG).
When `GAME_SEED` is unset, the server creates and logs a fresh cryptographic
seed at startup. Setting `GAME_SEED` makes room allocation, opaque physical
card identities, AI identities, and every deal reproducible from the same
ordered action stream. Identity and deal generators are domain-separated so
public opaque IDs do not expose the shuffle stream.

The four-bot realtime end-to-end test uses the invariant
`sol-vs-three-luna-v1` seed and Sol/Luna seat metadata, but deliberately drives
every seat with the same deterministic fallback strategy. It records a complete
round into a temporary Varmint cache, then runs the same table again in read
mode. This tests the record/replay mechanism, not model behavior. The replay
must execute no underlying generators and produce the same 56 intents, card
values, winners, scores, and final authoritative state. Player secrets and
observability span IDs remain cryptographically random because they are not game
actions and must not be replayed.

Run `pnpm record:ai-game` with `OPENAI_API_KEY` in `.env` to record a real
model-backed round under
`.varmint/hearts-games/sol-vs-three-luna-live-v5-labeled-choices/`. Override the
artifact directory name with `AI_GAME_RECORDING_NAME`. The command saves prompt
strings directly as Varmint inputs and value-based outputs. Each fixture
filename keeps its readable round/trick/player prefix and appends a SHA-256
digest of the complete generation contract: model, rendered prompt, system
prompt, structured-output contract, and provider reasoning settings. The
recorder also writes an ignored, transient `analysis.json` containing model
responses, usage, guarded decisions, accepted actions, and full server state
for local inspection. It then performs a cache-only replay and requires the
same decisions, actions, and final state without any model responses. Set
`TEST_LOG_LEVEL=debug` when running the recorder to stream the same complete
local spans exposed by the debug test commands. CI replays the checked-in v5
Sol/Luna recording in strict `read` mode, requiring all 56 decisions to be
cache hits with no model calls or fallbacks.

The player-versus-Terra Testing Library test replays the browser recording in
`.varmint/hearts-games/player-vs-terra-v1/` with the invariant
`player-vs-terra-browser-v1` seed. A simulated human uses the rendered controls
to pass and play all 26 cards while Terra participates through its ordinary
realtime boundary. The fixture contains 27 real Terra decisions. Replay uses a
read-only Varmint cache with a throwing underlying generator and asserts that
all 27 decisions are cache hits. In the recorded round, Terra captures every
scoring card and shoots the moon, producing the final score Terra 0, Player 26.

The Oh Hell realtime end-to-end test selects a compact legacy profile and plays
all five rounds of its `5, 4, 3, 2, 1` hand schedule. Its checked-in
`.varmint/oh-hell-games/sol-vs-three-luna-live-v2-trump-break/` fixture
contains 20 model bids and 60 model card plays. Run
`pnpm record:oh-hell-ai-game` to replace it with a paid live recording; normal
CI replays all 80 cached model outputs and verifies the final state.

## Observability

The room server renders compact, colored spans when it runs locally in an
interactive terminal. Timestamps, levels, services, events, outcomes, timings,
trace correlation, and attributes are visually distinct, while warnings and
errors keep their standard-error routing. Set `NO_COLOR` (or `FORCE_COLOR=0`)
for the same human-oriented layout without terminal color.

Production, CI, and piped output remain newline-delimited JSON suitable for
machines, including when `pnpm dev` is piped or redirected. Set
`LOG_FORMAT=json` to force JSON while debugging locally, or
`LOG_FORMAT=pretty` to explicitly request the human-oriented layout. An
explicit pretty format remains color-free when its output is not a terminal.
Realtime actions, room lifecycle, deals, passes, plays, trick resolution, AI
connection state, rendered model facts, decisions, fallbacks, OpenAI response
metadata, token usage, and action acknowledgements carry trace and span IDs,
outcomes, and durations.

These are privileged server-admin logs and intentionally include private hands,
card mappings, AI prompts, plans, and observations. They are never sent through
the realtime boundary. API keys, authorization values, cookies, passwords,
tokens, and player secrets are redacted recursively. Set `LOG_LEVEL` to
`debug`, `info`, `warn`, or `error`; the default is `info`.

## Rules

- Four players use the standard 52-card, 13-card-hand game.
- Three players remove the two of diamonds and receive 17 cards each.
- Two players use the full deck and receive 26 cards each.
- Passing rotates left, right, across, and hold for four players; the shorter
  rotations for two and three players preserve a regular hold round.
- The lowest club leads the first trick. Players must follow suit when able.
- Hearts cannot be led until broken unless the leader has only hearts.
- Hearts score one point and the queen of spades scores thirteen.
- Shooting the moon gives every opponent 26 points.
- When any score reaches 100, the lowest score wins.

## Information boundaries

The server owns the complete card mapping and validates every action. Each room
has 52 stable, opaque physical card IDs, but the server scrambles their
relationship to suits and ranks on every deal.

Clients receive two separate atom.io realtime projections:

- Public table state includes player names, scores, opaque hand and captured
  card IDs, and the values of cards currently visible in the trick.
- A private player projection includes only that player's visible hand and
  currently legal card IDs.

Hidden card values are absent from public state, acknowledgements, and room
events. A private device secret prevents another client from reclaiming a
publicly visible player ID.

AI prompts and structured model outputs use literal private card values such as
`QS` and `2H`. The AI's private server adapter resolves a selected value back to
its current physical card ID before submitting the same authoritative action as
a human client.

## Commands

| Command                     | Purpose                                                  |
| --------------------------- | -------------------------------------------------------- |
| `pnpm dev`                  | Start an isolated Vite client and realtime room server   |
| `pnpm build`                | Type-check and create the production client              |
| `pnpm start`                | Serve the production client and realtime rooms           |
| `pnpm test`                 | Run rules, generators, realtime privacy, and simulations |
| `pnpm test:debug`           | Run tests with complete debug-level server spans         |
| `pnpm test:e2e`             | Record and replay the deterministic four-bot round       |
| `pnpm test:e2e:debug`       | Run the four-bot replay with debug-level server spans    |
| `pnpm test:player-vs-terra` | Replay the recorded human-versus-Terra round             |
| `pnpm check`                | Run Oxc, TypeScript, ESLint, and Lasertag checks         |
| `pnpm fmt`                  | Format source and configuration files                    |
| `pnpm record:ai-game`       | Record and replay a real Sol-versus-Luna round           |
| `pnpm spellcheck`           | Check prose and identifiers                              |

Repository-specific authoring and secrecy policies live in
[AGENTS.md](./AGENTS.md).
