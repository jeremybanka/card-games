# wayfarer.quest

The single-page application for Wayfarer Quest, built with
[Vite](https://vite.dev/), [Preact](https://preactjs.com/),
[atom.io](https://atom.io.fyi/), and
[Lasertag](https://github.com/jeremybanka/lasertag).

## Start

Install the pinned toolchain with [mise](https://mise.jdx.dev/), then install
dependencies and start Vite:

```sh
mise install
pnpm install
pnpm dev
```

## Commands

| Command               | Purpose                                            |
| --------------------- | -------------------------------------------------- |
| `pnpm dev`            | Start the Vite development server                  |
| `pnpm build`          | Type-check and create the production build         |
| `pnpm preview`        | Preview the production build                       |
| `pnpm check`          | Run Oxc, TypeScript, ESLint, and Lasertag checks   |
| `pnpm fmt`            | Format supported source and configuration files    |
| `pnpm fmt:check`      | Verify formatting without changing files           |
| `pnpm lasertag check` | Check component CSS against rendered JSX structure |

Repository-specific authoring policies live in [AGENTS.md](./AGENTS.md).
