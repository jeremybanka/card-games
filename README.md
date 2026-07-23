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
`off`.

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
`sol-vs-three-luna-v1` seed. It records a complete round with one Sol seat and
three Luna seats into a temporary Varmint cache, then runs the same table again
in read mode. The replay must execute no underlying generators and produce the
same 56 intents, card values, winners, scores, and final authoritative state.
Player secrets and observability span IDs remain cryptographically random
because they are not game actions and must not be replayed.

## Observability

The room server writes newline-delimited JSON spans to standard output and
standard error. Realtime actions, room lifecycle, deals, passes, plays, trick
resolution, AI connection state, rendered model facts, decisions, fallbacks,
OpenAI response metadata, token usage, and action acknowledgements carry trace
and span IDs, outcomes, and durations.

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

## Commands

| Command           | Purpose                                                  |
| ----------------- | -------------------------------------------------------- |
| `pnpm dev`        | Start the Vite client and realtime room server           |
| `pnpm build`      | Type-check and create the production client              |
| `pnpm start`      | Serve the production client and realtime rooms           |
| `pnpm test`       | Run rules, generators, realtime privacy, and simulations |
| `pnpm test:e2e`   | Record and replay the deterministic four-bot round       |
| `pnpm check`      | Run Oxc, TypeScript, ESLint, and Lasertag checks         |
| `pnpm fmt`        | Format source and configuration files                    |
| `pnpm spellcheck` | Check prose and identifiers                              |

Repository-specific authoring and secrecy policies live in
[AGENTS.md](./AGENTS.md).
