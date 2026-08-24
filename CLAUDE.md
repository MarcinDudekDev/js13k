# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Two shipping surfaces for the same game — **Tribute Unicorn Attack** (a Robot Unicorn Attack tribute: an endless runner with jump, double-jump, dash and dolphin-smashing):

| Surface | Entry | Runs as | Constraint |
|---|---|---|---|
| **js13k jam entry** | `jam/src.js` | Plain `<canvas>` + one `<script>`, zero deps | Zipped build must stay **under 13312 bytes** |
| **Web app** | `src/game/rua.ts` + `src/components/game-view.tsx` | TanStack Start / React 19 route at `/` | No size limit; React HUD chrome |

**These are two separate implementations of the same game, not one shared engine.** `jam/src.js` is hand-golfed vanilla JS with the HUD drawn onto the canvas; `src/game/rua.ts` exports `createGame(canvas, onHud)` returning a `GameAPI`, and React renders the HUD from the `Hud` snapshots it pushes. A gameplay change made in one does **not** propagate — port it deliberately, or say which surface you changed.

This repo was exported from a **Grok App Builder** sandbox. `AGENTS.md` (and everything under `.grok/`) is that platform's contract, written for a Linux container at `/workspace` listening on `0.0.0.0:8080`. Treat it as inherited context, not as instructions for this machine — but the parts it enforces mechanically (below) are real and still bite.

## Commands

```bash
npm install              # node_modules is NOT in the repo; nothing below works without it

npm run dev              # dev server on 0.0.0.0:8080
npm run build            # vite build + db:migrate
npm run preview          # preview server on :8081
npm run typecheck        # tsc --noEmit
npm run lint             # eslint .
npm run format           # prettier --write .
npm test                 # node --test over scripts/**/*.test.mjs + two src/lib tests

npm run jam:build        # minify jam/src.js -> public/jam.html, jam/index.min.html, public/rua.zip
```

Run a single test file: `node --test scripts/brand-check.test.mjs`. For the TypeScript ones: `node --experimental-strip-types --test src/lib/auth/gate-identity.test.ts`.

**Never start Vite directly (`vite dev`, `npx vite`).** Only the npm scripts route through `scripts/with-app-env.mjs`, which merges `.grok/app-env.json` (`VITE_AUTH_ENABLED`) into the environment before Vite's `loadEnv` runs. Bypassing it makes the dev server and the build disagree about whether auth exists — `npm run check:auth` exists solely to detect that divergence (exit 0 agree / 1 diverged / 2 could not observe).

### Running the jam entry locally

`jam/index.html` loads `src.js` unbuilt, so any static server over `jam/` plays it — no build, no `npm install`:

```bash
python3 -m http.server 8123 --directory jam   # then open /index.html (source) or /index.min.html (built)
```

`npm run jam:build` prints the zip size against the 13312 limit on every run. Current entry is ~7.3 KB zipped, roughly 55% of budget.

## Architecture notes

**Vite config is load-bearing and partly not yours.** `vite.config.ts` pins `0.0.0.0:8080` (dev) and `:8081` (preview), and wires four things that the platform depends on: `grokPwaPlugin()` (injects the "Created with Grok" pill and overwrites all `og:*` / `twitter:*` meta on every HTML response — so never put social meta in `__root.tsx`), `appEnvPlugin()` (serves `/__app-env` for the auth-invariant probe), a `/auth/popup` middleware handled in the config itself rather than as a route, and a `pgliteBootstrapPlugin` that only wakes when `migrations/` actually contains migration files.

**Auth and database are OFF for this app** (`.grok/app-env.json`: `VITE_AUTH_ENABLED: false`, `deploy.database: false`). The wiring in `src/lib/auth/` and `src/lib/db.ts` is pre-built template scaffolding that this game does not use — high scores live in `localStorage` under the key `rua.v1`. Do not import `authMiddleware` / `requireUserId` / `@/lib/db` while auth is off: the dev user those return is preview-only, so every such server function rejects real visitors once deployed.

**`server/`, `public/__grok/` and `scripts/grok-pwa-*` are platform chrome.** New server routes belong in `src/routes/`, never `server/`.

**`scripts/` is a self-tested toolbox**, not glue — most modules there ship a sibling `.test.mjs` and are imported by `browser-smoke.mjs`, which drives Playwright for QA and folds in the brand check and the auth-invariant comparison.

## Known local-portability gotchas

The sandbox export assumed `/workspace` and a preinstalled global `node_modules`. Fixed here (don't reintroduce):

- `jam/build.mjs` derives its paths from `import.meta.url` instead of hard-coding `/workspace/public`.
- `terser` is declared in `devDependencies`; it was previously only resolving from a stray `~/node_modules`.

`startup.sh` is still the sandbox's restart contract — it `cd`s to `/workspace` and is inert on this machine. Leave it alone rather than "fixing" it; the platform requires that exact path if the workspace is ever revived.
