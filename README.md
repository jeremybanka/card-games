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
has 52 stable, opaque physical card IDs, but the server securely scrambles their
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

| Command           | Purpose                                               |
| ----------------- | ----------------------------------------------------- |
| `pnpm dev`        | Start the Vite client and realtime room server        |
| `pnpm build`      | Type-check and create the production client           |
| `pnpm start`      | Serve the production client and realtime rooms        |
| `pnpm test`       | Run Hearts rules, privacy, and full-round simulations |
| `pnpm check`      | Run Oxc, TypeScript, ESLint, and Lasertag checks      |
| `pnpm fmt`        | Format source and configuration files                 |
| `pnpm spellcheck` | Check prose and identifiers                           |

Repository-specific authoring and secrecy policies live in
[AGENTS.md](./AGENTS.md).
