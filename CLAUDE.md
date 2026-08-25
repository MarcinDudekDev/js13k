# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Tribute Unicorn Attack** — a js13k 2026 entry. An endless runner (jump, double-jump, dash, smash dolphins) drawn on a 2D `<canvas>`.

The whole game is **one file of dependency-free vanilla JavaScript**: `src.js`. No framework, no bundler, no imports. `index.html` is 12 lines and loads it with a plain `<script src>`. That is deliberate and is the hard constraint of the project — see Size budget below.

The repo was originally exported from a Grok App Builder sandbox that wrapped the game in a TanStack Start / React app. **That wrapper was deleted** (along with `AGENTS.md`, `.grok/`, `server/`, `scripts/`, `migrations/`, Vite and TypeScript config). If you find a reference to React, TanStack, Vercel, `/workspace` or `0.0.0.0:8080` anywhere, it is a leftover and should go. Do not reintroduce a build framework.

## Commands

```bash
npm install        # only terser + prettier
npm run build      # minify src.js -> dist/index.html + dist/rua.zip, print size vs the cap
npm run serve      # python3 -m http.server 8123 from the repo root
npm run format
```

There are no tests and no lint config. Verification is done by playing it in a browser (see below).

Open `http://127.0.0.1:8123/index.html` for the readable source build, or `/dist/index.html` for the minified one that actually ships. Both should behave identically — check both after any change to `src.js`, because minification with `mangle.toplevel` has bitten this kind of code before.

## Size budget — the constraint everything answers to

`dist/rua.zip` must stay **under 13312 bytes**. `npm run build` prints the number and exits non-zero if it goes over.

Currently **7608 / 13312 (57.2%)**, so there is real headroom — but every change is priced in bytes. This is why `src.js` looks the way it does: single-letter globals (`W`, `H`, `X` for the 2D context, `P` for the player, `T` for time), no comments in hot paths, numeric mode flags (`0` title, `1` play, `2` dead), and hundreds of unexplained numeric constants. **That is correct for this file.** Do not "clean it up" — naming the magic numbers or expanding the identifiers would cost more than the readability is worth here. A code-quality scan will score this file badly on MagicNumbers, Naming and Comments; ignore it.

## Architecture

One file, roughly in this order:

- **State** — module-scope `let`s and small object literals. `P` is the player; `gaps` / `stars` / `obs` are world objects; `pts` is a **preallocated particle pool** (ring buffer via `pi`), never grown at runtime.
- **Audio** (`unlock`, `beep`, `noise`, `sfx`, `loopMus`) — WebAudio, procedurally generated. Everything is created on demand; nothing is decoded on the frame path.
- **World** (`world`, `fill`, `gyRaw`, `gy`, `inGap`) — `world()` is the full reset used by both new-game and back-to-title. `gyRaw(wx)` is the terrain height; `gy(wx)` is the same plus the gap check. Callers that already know they are not over a gap should call `gyRaw` to avoid a second scan of `gaps`.
- **Draw helpers** (`hill`, `star`, `unicorn`, `dolphin`, `spike`, `scrim`).
- **`step(dt)`** — fixed-timestep simulation, accumulator in `loop()`, `dt` capped at 0.1 so a backgrounded tab does not teleport the player.
- **`draw()`** — all rendering, ordered back to front.
- **Input** — `onkeydown` / `onkeyup` / pointer handlers at the bottom.

Mode transitions: `go()` starts or restarts a run, `die()` ends one, and `Escape` in `onkeydown` goes from dead back to title by calling `world()` and setting `mode = 0`.

## Rendering performance

The frame loop was profiled and tuned (~20% less main-thread JS per frame under 10× CPU throttle). The things that got it there are easy to undo by accident:

- **The sky gradient and hill palette are memoised**, keyed on `skyK`. They depend on the day clock, not on the frame. Do not move `PAL` / `DA` / `mix` / the `SK*` tables back inside `draw()`, and do not call `createLinearGradient` per frame.
- **Stars are batched into 5 alpha buckets** (`SB`) so the 64-star field costs 5 fills instead of 64. Per-star `globalAlpha` would put it back to 64.
- **Terrain is sampled at 16px** (`hill`) and the ridge at 12px. Finer steps were measurably slower and visually identical — the terrain is three low-frequency sines, so the extra vertices land inside the stroke width.
- Invariant canvas state (`lineWidth`, `lineCap`) is hoisted out of the tail and mane loops. Setting it per iteration is the easy regression.

Measuring: CPU time per frame comes from CDP `Performance.getMetrics` (`ScriptDuration` / `TaskDuration`) over ~1500 frames, with `Emulation.setCPUThrottlingRate` armed **before** navigation. Unthrottled rAF deltas are useless here — they pin to the 120 Hz vsync and hide everything.

Known remaining lever, deliberately not taken: `resize()` caps `dpr` at 2, so on a retina display the sky and three hill fills rasterise at ~4× the CSS pixel count. Capping at 1.5 would cut that a lot, but it is a sharpness regression — a taste call, not a free win.

## Verifying a change

**Test in Firefox, not just Chrome.** js13k requires the entry to work in both, and the
2026 submission was rejected for "does not load on latest Firefox" after being verified
only in Chromium. Chromium-only testing is how that shipped.

Real Firefox can be driven with geckodriver + selenium (both installed):

```bash
geckodriver --version              # /opt/homebrew/bin/geckodriver
# selenium venv used for this: /Users/cminds/claude-tmp/js13k/.venv-ff
```

Playwright's Firefox is a patched build and is a weaker signal than the real app. Note
that `firefox --headless --screenshot` fires at the load event, before the first
requestAnimationFrame, so it photographs a blank canvas and looks like a failure when
nothing is wrong. Do not diagnose from that alone.

Two things about the shipped artifact that a browser will never show you, and that broke
the first submission:

- **Zip entry permissions.** `zipfile.writestr` defaults to mode 0600. A host that
  extracts as one user and serves as another then gets an unreadable file. `build.mjs`
  now forces 0644 - check with `unzip -Z -l dist/rua.zip`.
- **Explicit document structure.** The HTML must carry real `<html>`, `<head>` and
  `<body>` tags even though browsers infer them. A jam host that injects its own overlay
  by string-matching `</body>` has nothing to match otherwise, and the engines recover
  from the result differently.

Play it. Loading the page is not enough — drive it with real key events and check the state machine, because most regressions here are in transitions rather than in rendering:

1. Title screen paints and the attract-mode unicorn runs.
2. Space starts a run.
3. Falling in a gap kills you and shows the death card with time / stars / smashed.
4. Jump+Dash restarts, `Escape` returns to the title with the world reset and `BEST` preserved.
5. Check `/dist/index.html` too, not just `/index.html`.

For contrast work, measure against the **rendered pixels** rather than the CSS values — the scene scrolls under the HUD text, so contrast varies frame to frame and has to be sampled as a worst case over many frames. That is how the title-screen hints ended up on a scrim.
