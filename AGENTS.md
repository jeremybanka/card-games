# wayfarer.quest

- This repository contains one Vite application; keep application code in
  `src/` and static assets in `public/`.
- Prefer `.ts` and `.tsx` for source files and Node scripts. Do not create
  `.js`, `.cjs`, `.mjs`, or `.mts` source files; modern Node can run erasable
  TypeScript directly.
- Define source state with `atom.io`. Name tokens for their kind (for example,
  `questCountAtom`) and give public state explicit types.
- Treat the server as authoritative for every game action. Clients submit
  intents containing opaque physical card IDs; the server validates ownership,
  phase, turn order, and Hearts rules before changing state.
- Keep full card-value mappings in server-only modules. Expose table state and
  each player's private hand through separate atom.io realtime providers. Never
  add hidden card values to public projections, acknowledgements, or
  client-readable state. Privileged server-admin logs may include complete game
  and AI state, but must redact credentials and must never cross the realtime
  boundary.
- Preserve physical card IDs for the lifetime of a room, but scramble their
  relationship to card values on every deal.
- Treat every AI seat as an ordinary realtime player with its own private
  atom.io Silo. Keep AI observations, plans, prompts, and private hand facts out
  of public room state. Privileged server logs may record them for diagnostics.
  AI actions must use the same schemas and authoritative server handlers as
  human actions.
- Give each exported JSX component a same-named sibling CSS Module
  (`AppShell.tsx` and `AppShell.module.css`). Import it as `css`, expose only
  `.class`, and attach `css.class` to the component root.
- Exported components must have multi-word names and render their matching
  hyphenated custom root (`AppShell` renders `<app-shell>`).
- Mirror rendered DOM in nested CSS. Prefer semantic elements, native form
  controls, and descriptive custom tags; never use `<div>`.
- Keep `src/globals.css` limited to resets, fonts, and semantic tokens. Keep
  component styling in CSS Modules.
- After component or CSS Module changes, run `pnpm lasertag check`. Run
  `pnpm check`, `pnpm test`, and `pnpm build` before handing off changes.
