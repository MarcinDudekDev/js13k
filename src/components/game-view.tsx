import { useEffect, useRef, useState } from "react";
import { ArrowUp, Pause, Play, Volume2, VolumeX, Zap } from "lucide-react";
import { createGame, type GameAPI, type Hud } from "@/game/rua";
import { Button } from "@/components/ui/button";

const INITIAL: Hud = {
  mode: "title",
  score: 0,
  high: 0,
  combo: 0,
  dist: 0,
  muted: false,
  super: 0,
  time: 0,
  stars: 0,
  smashed: 0,
};

export function GameView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const apiRef = useRef<GameAPI | null>(null);
  const [hud, setHud] = useState<Hud>(INITIAL);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const game = createGame(canvas, setHud);
    apiRef.current = game;
    return () => {
      game.destroy();
      apiRef.current = null;
    };
  }, []);

  const api = apiRef.current;
  const playing = hud.mode === "play";
  const showControls = hud.mode === "play" || hud.mode === "pause" || hud.mode === "dead";

  function fmtTime(t: number) {
    const s = Math.max(0, t | 0);
    const m = (s / 60) | 0;
    const r = s % 60;
    return m + ":" + (r < 10 ? "0" : "") + r;
  }

  async function saveFile(path: string, name: string) {
    try {
      const res = await fetch(path);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch {
      window.open(path, "_blank", "noopener");
    }
  }

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-bg text-fg">
      <div className="relative min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full touch-none"
          aria-label="Tribute Unicorn Attack"
        />

        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col">
          {hud.combo > 1 && playing ? (
            <div
              className="absolute top-4 left-1/2 -translate-x-1/2 font-mono tracking-widest text-accent uppercase"
              style={{
                fontSize: `${0.875 * (1 + Math.min(1, (hud.combo - 2) / 98))}rem`,
              }}
            >
              Combo x{hud.combo}
            </div>
          ) : null}

          {hud.super > 0 && playing ? (
            <div className="absolute top-14 left-1/2 -translate-x-1/2 text-center">
              <p className="font-display text-5xl font-semibold tracking-[0.22em] sm:text-6xl">
                {(["S", "U", "P", "E", "R"] as const).map((ch, i) => (
                  <span
                    key={ch}
                    style={{
                      color: ["#ff3b5c", "#ff8a3d", "#ffd23f", "#3dce6a", "#3db8ff"][i],
                      textShadow: "0 0 18px currentColor",
                    }}
                  >
                    {ch}
                  </span>
                ))}
              </p>
            </div>
          ) : null}

          {hud.mode === "title" ? (
            <div className="pointer-events-auto m-auto flex w-full max-w-md flex-col items-center px-6 text-center">
              <p className="mb-3 text-xs tracking-[0.28em] text-muted uppercase">js13k 2026</p>
              <h1 className="font-display text-4xl leading-none font-semibold tracking-[-0.04em] sm:text-5xl">
                Tribute
                <br />
                Unicorn
                <br />
                Attack
              </h1>
              <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">
                Love. And also, rainbows.
              </p>
              <Button className="mt-8 h-12 w-full max-w-xs rounded-lg text-base" onClick={() => api?.start()}>
                <Play className="mr-2 size-4" />
                Play
              </Button>
              <div className="mt-3 flex w-full max-w-xs flex-col gap-2">
                <button
                  type="button"
                  className="inline-flex h-11 items-center justify-center rounded-md border border-border-strong bg-bg-elevated text-sm text-fg"
                  onClick={() => saveFile("/tribute-unicorn-attack-source.zip", "tribute-unicorn-attack-source.zip")}
                >
                  Download source (.zip)
                </button>
                <button
                  type="button"
                  className="inline-flex h-11 items-center justify-center rounded-md border border-border-strong bg-bg-elevated text-sm text-fg"
                  onClick={() => saveFile("/rua.zip", "rua-js13k.zip")}
                >
                  Download js13k entry (7 KB)
                </button>
              </div>
              {hud.high > 0 ? (
                <p className="mt-5 font-mono text-xs tabular-nums text-subtle">Best {hud.high | 0}</p>
              ) : null}
              <p className="mt-8 max-w-sm text-xs leading-relaxed text-subtle">
                Jump with Space, Z, or W — hold for extra height. Dash with Shift or X. Combo x100:
                SUPER (Flappy hover). M mutes.
              </p>
            </div>
          ) : null}

          {hud.mode === "dead" ? (
            <div className="pointer-events-auto m-auto flex w-full max-w-sm flex-col items-center px-6 text-center">
              <div className="w-full rounded-xl border border-border-strong bg-bg-elevated p-6">
                <p className="font-mono text-3xl tabular-nums">{hud.score | 0}</p>
                <p className="mt-1 font-mono text-xs text-muted">Best {hud.high | 0}</p>
                <dl className="mt-5 grid grid-cols-3 gap-2 font-mono text-xs">
                  <div>
                    <dt className="tracking-widest text-muted uppercase">Time</dt>
                    <dd className="mt-1 text-lg tabular-nums text-fg">{fmtTime(hud.time)}</dd>
                  </div>
                  <div>
                    <dt className="tracking-widest text-muted uppercase">Stars</dt>
                    <dd className="mt-1 text-lg tabular-nums text-fg">{hud.stars | 0}</dd>
                  </div>
                  <div>
                    <dt className="tracking-widest text-muted uppercase">Smashed</dt>
                    <dd className="mt-1 text-lg tabular-nums text-fg">{hud.smashed | 0}</dd>
                  </div>
                </dl>
                <p className="mt-6 text-sm text-fg">Jump + Dash to ride again</p>
              </div>
            </div>
          ) : null}

          {hud.mode === "pause" ? (
            <div className="pointer-events-auto m-auto flex w-full max-w-sm flex-col items-center px-6 text-center">
              <div className="w-full rounded-xl border border-border-strong bg-bg-elevated p-6">
                <h2 className="font-display text-3xl font-semibold tracking-[-0.03em]">Paused</h2>
                <p className="mt-2 text-sm text-muted">The rainbow can wait.</p>
                <Button className="mt-6 h-12 w-full rounded-lg" onClick={() => api?.resume()}>
                  Resume
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <footer
        className="shrink-0 border-t border-border-strong bg-bg-elevated px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        style={{ visibility: showControls ? "visible" : "hidden" }}
        aria-hidden={!showControls}
      >
          <div className="mx-auto flex max-w-lg items-stretch gap-3">
            <button
              type="button"
              className="flex h-14 min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-fg text-base font-semibold text-accent-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg"
              onPointerDown={(e) => {
                e.preventDefault();
                api?.jump();
                api?.jumpHold(true);
              }}
              onPointerUp={() => api?.jumpHold(false)}
              onPointerCancel={() => api?.jumpHold(false)}
              onPointerLeave={() => api?.jumpHold(false)}
            >
              <ArrowUp className="size-5" />
              Jump
            </button>
            <button
              type="button"
              className="flex h-14 min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-fg text-base font-semibold text-accent-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg"
              onPointerDown={(e) => {
                e.preventDefault();
                api?.dash();
              }}
            >
              <Zap className="size-5" />
              Dash
            </button>
            <button
              type="button"
              className="grid size-14 min-h-11 shrink-0 place-items-center rounded-lg bg-fg text-accent-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg"
              onClick={() => api?.toggleMute()}
              aria-label={hud.muted ? "Unmute" : "Mute"}
            >
              {hud.muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
            </button>
            {playing ? (
              <button
                type="button"
                className="grid size-14 min-h-11 shrink-0 place-items-center rounded-lg bg-fg text-accent-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg"
                onClick={() => api?.pause()}
                aria-label="Pause"
              >
                <Pause className="size-5" />
              </button>
            ) : null}
          </div>
        </footer>
    </div>
  );
}
