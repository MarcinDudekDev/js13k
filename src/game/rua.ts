import { createAudio, type AudioBus } from "./audio";

export type Mode = "title" | "play" | "dead" | "pause";

export type Hud = {
  mode: Mode;
  score: number;
  high: number;
  combo: number;
  dist: number;
  muted: boolean;
  super: number;
  time: number;
  stars: number;
  smashed: number;
};

export type GameAPI = {
  start(): void;
  restart(): void;
  toTitle(): void;
  pause(): void;
  resume(): void;
  jump(): void;
  dash(): void;
  jumpHold(v: boolean): void;
  toggleMute(): void;
  unlock(): void;
  destroy(): void;
};

const SAVE = "rua.v1";
const RB = ["#ff3b5c", "#ff8a3d", "#ffd23f", "#3dce6a", "#3db8ff", "#9b6dff"];
const STEP = 1 / 60;
const JUMP_BUF = 0.16;
const COYOTE = 0.12;
const DASH_T = 0.48;
const DASH_CD = 0.38;
const SUPER_T = 10;

type Star = { x: number; y: number; alive: boolean };
type Obs = { x: number; y: number; kind: 0 | 1; alive: boolean };
type Gap = { x: number; w: number };
type Floater = { x: number; y: number; t: number; txt: string };
type Pt = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  l: number;
  m: number;
  r: number;
  c: string;
  g: number;
  alive: boolean;
};

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadHi(): number {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE) || "null") as { v?: number; hi?: number } | null;
    if (s && s.v === 1 && typeof s.hi === "number") return s.hi;
  } catch {
    /* ignore quota / parse */
  }
  return 0;
}

function saveHi(hi: number) {
  try {
    localStorage.setItem(SAVE, JSON.stringify({ v: 1, hi }));
  } catch {
    /* ignore */
  }
}

function starPath(ctx: CanvasRenderingContext2D, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? r : r * 0.4;
    const x = Math.cos(a) * rad;
    const y = Math.sin(a) * rad;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

export function createGame(canvas: HTMLCanvasElement, onHud: (h: Hud) => void): GameAPI {
  const raw = canvas.getContext("2d");
  if (!raw) throw new Error("Canvas unsupported");
  const ctx: CanvasRenderingContext2D = raw;

  const audio: AudioBus = createAudio();
  const reduce =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  let W = 960;
  let H = 540;
  let raf = 0;
  let last = 0;
  let acc = 0;
  let time = 0;
  let hudT = 0;
  let mode: Mode = "title";
  let muted = false;
  let high = loadHi();
  let score = 0;
  let combo = 0;
  let comboT = 0;
  let dist = 0;
  let cam = 0;
  let speed = 300;
  let hitstop = 0;
  let trauma = 0;
  let seed = 1;
  let rng = mulberry32(1);

  const keys = new Set<string>();
  let jumpBuf = 0;
  let dashBuf = 0;

  const player = {
    y: 0,
    vy: 0,
    onG: true,
    jumps: 0,
    dash: 0,
    dashCd: 0,
    coyote: 0,
    squash: 1,
    rot: 0,
    deadT: 0,
    inv: 0,
  };

  let starN = 0;
  let smashN = 0;
  let playT = 0;
  let superT = 0;
  let jumpTouch = false;
  let wasSuper = false;
  let deadJ = false;
  let deadD = false;
  const nyan: { wx: number; y: number }[] = [];

  const gaps: Gap[] = [];
  const stars: Star[] = [];
  const obs: Obs[] = [];
  const floaters: Floater[] = [];
  let nextX = 0;

  const pool: Pt[] = Array.from({ length: 420 }, () => ({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    l: 0,
    m: 1,
    r: 2,
    c: "#fff",
    g: 0,
    alive: false,
  }));
  let pIdx = 0;

  const skyStars = Array.from({ length: 40 }, () => ({
    x: Math.random(),
    y: Math.random() * 0.7,
    r: 0.4 + Math.random() * 1.4,
    p: Math.random() * Math.PI * 2,
  }));

  let hudKey = "";
  function emitHud() {
    const next: Hud = {
      mode,
      score: score | 0,
      high: high | 0,
      combo,
      dist: dist | 0,
      muted,
      super: superT,
      time: playT,
      stars: starN,
      smashed: smashN,
    };
    const k = `${next.mode}|${next.score}|${next.high}|${next.combo}|${next.muted}|${next.super | 0}|${starN}|${smashN}|${playT | 0}`;
    if (k === hudKey) return;
    hudKey = k;
    onHud(next);
  }

  function spawnPt(
    x: number,
    y: number,
    vx: number,
    vy: number,
    l: number,
    r: number,
    c: string,
    g: number,
  ) {
    for (let i = 0; i < pool.length; i++) {
      const p = pool[(pIdx + i) % pool.length];
      if (!p.alive) {
        p.x = x;
        p.y = y;
        p.vx = vx;
        p.vy = vy;
        p.l = l;
        p.m = l;
        p.r = r;
        p.c = c;
        p.g = g;
        p.alive = true;
        pIdx = (pIdx + i + 1) % pool.length;
        return;
      }
    }
  }

  function burst(x: number, y: number, n: number, spd: number, cols: string[]) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * spd;
      spawnPt(
        x,
        y,
        Math.cos(a) * s,
        Math.sin(a) * s - 40,
        0.35 + Math.random() * 0.25,
        2 + Math.random() * 3.5,
        cols[i % cols.length],
        280,
      );
    }
  }

  function groundAt(wx: number): number {
    for (let i = 0; i < gaps.length; i++) {
      const g = gaps[i];
      if (wx >= g.x && wx < g.x + g.w) return H + 240;
    }
    const n =
      Math.sin(wx * 0.0068) * 26 + Math.sin(wx * 0.017 + 1.3) * 14 + Math.sin(wx * 0.039 + 0.4) * 7;
    return H * 0.72 + n;
  }

  function inGap(wx: number) {
    for (let i = 0; i < gaps.length; i++) {
      const g = gaps[i];
      if (wx >= g.x && wx < g.x + g.w) return true;
    }
    return false;
  }

  function resetWorld(s: number) {
    seed = s;
    rng = mulberry32(s);
    cam = 0;
    dist = 0;
    score = 0;
    combo = 0;
    comboT = 0;
    speed = 300;
    nextX = 0;
    gaps.length = 0;
    stars.length = 0;
    obs.length = 0;
    floaters.length = 0;
    for (const p of pool) p.alive = false;
    player.y = groundAt(px()) - 2;
    player.vy = 0;
    player.onG = true;
    player.jumps = 0;
    player.dash = 0;
    player.dashCd = 0;
    player.coyote = 0;
    player.squash = 1;
    player.rot = 0;
    player.deadT = 0;
    player.inv = 0;
    trauma = 0;
    jumpBuf = 0;
    dashBuf = 0;
    starN = 0;
    smashN = 0;
    playT = 0;
    superT = 0;
    wasSuper = false;
    deadJ = false;
    deadD = false;
    nyan.length = 0;
    audio.setSuper(false);
    ensureWorld();
    player.y = groundAt(px()) - 2;
  }

  function px() {
    return cam + W * 0.22;
  }

  function ensureWorld() {
    const look = cam + W + 900;
    while (nextX < look) {
      const u = rng();
      const sc = H / 540;
      const gapW = (90 + rng() * 70 + Math.min(80, dist * 0.02)) * sc;
      if (u < 0.32 && nextX > 600) {
        gaps.push({ x: nextX, w: gapW });
        const mid = nextX + gapW * 0.5;
        const gy = H * 0.72;
        const n = 3 + ((rng() * 3) | 0);
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n;
          stars.push({
            x: nextX + 16 + t * (gapW - 32),
            y: gy - 70 * sc - Math.sin(t * Math.PI) * 70 * sc,
            alive: true,
          });
        }
        nextX += gapW;
      } else {
        const len = (280 + rng() * 260) * sc;
        const end = nextX + len;
        const nStar = 2 + ((rng() * 4) | 0);
        for (let i = 0; i < nStar; i++) {
          const x = nextX + 40 + rng() * (len - 80);
          stars.push({ x, y: groundAt(x) - (40 + rng() * 70) * sc, alive: true });
        }
        const nObs = dist > 400 && rng() < 0.45 + Math.min(0.25, dist * 0.0002) ? 1 + (rng() < 0.35 ? 1 : 0) : 0;
        for (let i = 0; i < nObs; i++) {
          const x = nextX + 90 + rng() * Math.max(40, len - 180);
          if (x > end - 90) continue;
          obs.push({ x, y: 0, kind: rng() < 0.7 ? 0 : 1, alive: true });
        }
        nextX = end;
      }
    }
    const cull = cam - 250;
    for (let i = gaps.length - 1; i >= 0; i--) if (gaps[i].x + gaps[i].w < cull) gaps.splice(i, 1);
    for (let i = stars.length - 1; i >= 0; i--) if (!stars[i].alive || stars[i].x < cull) stars.splice(i, 1);
    for (let i = obs.length - 1; i >= 0; i--) if (!obs[i].alive || obs[i].x < cull) obs.splice(i, 1);
  }

  function doJump() {
    if (mode === "title") {
      start();
      return;
    }
    if (mode === "dead") {
      deadJ = true;
      if (deadJ && deadD) restart();
      return;
    }
    if (mode === "pause") return;
    if (mode !== "play") return;
    jumpBuf = JUMP_BUF;
  }

  function doDash() {
    if (mode === "title") {
      start();
      return;
    }
    if (mode === "dead") {
      deadD = true;
      if (deadJ && deadD) restart();
      return;
    }
    if (mode !== "play") return;
    dashBuf = 0.1;
  }

  function tryJump() {
    const sc = H / 540;
    if (superT > 0) {
      if (jumpBuf <= 0 || mode !== "play") return;
      player.vy = -340 * sc;
      player.onG = false;
      player.squash = 1.12;
      jumpBuf = 0;
      audio.play("jump");
      burst(W * 0.22, player.y, 4, 80, RB);
      return;
    }
    const can = player.onG || player.coyote > 0 || player.jumps < 2;
    if (!can || jumpBuf <= 0) return;
    const first = player.onG || player.coyote > 0;
    player.vy = first ? -778 * sc : -670 * sc;
    player.onG = false;
    player.coyote = 0;
    player.jumps = first ? 1 : 2;
    player.squash = 1.22;
    jumpBuf = 0;
    audio.play("jump");
    const x = W * 0.22;
    burst(x, player.y, 6, 120, ["#fff5ee", "#f2d6de"]);
  }

  function tryDash() {
    if (superT > 0) return;
    if (player.dash > 0 || player.dashCd > 0 || dashBuf <= 0) return;
    player.dash = DASH_T;
    player.dashCd = DASH_CD + DASH_T;
    player.inv = Math.max(player.inv, 0.95);
    if (player.vy > 80) player.vy *= 0.45;
    else if (player.vy > 0) player.vy *= 0.7;
    else player.vy *= 0.9;
    player.squash = 0.82;
    dashBuf = 0;
    audio.play("dash");
    trauma = Math.min(1, trauma + 0.25);
  }

  function kill() {
    if (mode !== "play") return;
    if (superT > 0 || player.inv > 0 || player.dash > 0) return;
    audio.setSuper(false);
    wasSuper = false;
    mode = "dead";
    player.deadT = 0;
    deadJ = false;
    deadD = false;
    player.vy = -420 * (H / 540);
    audio.play("crash");
    trauma = 0.85;
    hitstop = reduce ? 0 : 0.08;
    burst(W * 0.22, player.y - 20, 14, 220, RB);
    if (score > high) {
      high = score | 0;
      saveHi(high);
    }
    emitHud();
  }

  function start() {
    mode = "play";
    score = 0;
    combo = 0;
    comboT = 0;
    starN = 0;
    smashN = 0;
    playT = 0;
    emitHud();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => audio.startMusic());
    });
  }

  function restart() {
    resetWorld((Math.random() * 1e9) | 0);
    mode = "play";
    emitHud();
    requestAnimationFrame(() => audio.startMusic());
  }

  /** Back out of the death screen to the attract-mode title. */
  function toTitle() {
    if (mode !== "dead") return;
    audio.setSuper(false);
    wasSuper = false;
    resetWorld((Math.random() * 1e9) | 0);
    mode = "title";
    emitHud();
  }

  function addScore(n: number, x: number, y: number, label: string) {
    const m = 1 + combo * 0.25;
    const got = Math.round(n * m);
    score += got;
    combo += 1;
    comboT = 2.2;
    floaters.push({ x, y, t: 0.8, txt: label });
    if (mode === "play" && combo > 0 && combo % 100 === 0) {
      superT = SUPER_T;
      floaters.push({ x: W * 0.22, y: player.y - 80 * (H / 540), t: 1.6, txt: "SUPER" });
      audio.play("dash");
      audio.play("star");
      burst(W * 0.22, player.y - 20, 16, 220, RB);
    }
  }

  function lookahead(kind: "gap" | "obs"): number {
    const x = px();
    if (kind === "gap") {
      let best = 9e9;
      for (const g of gaps) {
        if (g.x > x && g.x - x < best) best = g.x - x;
      }
      return best;
    }
    let best = 9e9;
    for (const o of obs) {
      if (o.alive && o.x > x && o.x - x < best) best = o.x - x;
    }
    return best;
  }

  function update(dt: number) {
    time += dt;
    const sc = H / 540;
    if (mode === "pause") return;

    jumpBuf = Math.max(0, jumpBuf - dt);
    dashBuf = Math.max(0, dashBuf - dt);
    tryJump();
    tryDash();

    if (mode === "title") {
      const g = lookahead("gap");
      const o = lookahead("obs");
      if (g < 140 * sc && player.onG) jumpBuf = JUMP_BUF;
      if (o < 110 * sc && player.dashCd <= 0) dashBuf = 0.1;
    }

    speed = (mode === "title" ? 240 : 300 + Math.min(380, dist * 0.016)) * sc;
    const superOn = superT > 0;
    if (superOn !== wasSuper) {
      wasSuper = superOn;
      audio.setSuper(superOn);
    }
    const moving = mode === "play" || mode === "title" || mode === "dead";
    if (moving)
      cam += speed * dt * (player.dash > 0 && mode !== "dead" ? 1.7 : 1) * (superOn ? 1.25 : 1);

    if (mode === "play") {
      dist = cam;
      score += speed * dt * 0.04;
      playT += dt;
    }

    comboT -= dt;
    if (comboT <= 0) combo = 0;

    const gx = px();
    const gy = groundAt(gx);
    const g = 2100 * sc;
    const wasDash = player.dash > 0;
    player.dash = Math.max(0, player.dash - dt);
    player.dashCd = Math.max(0, player.dashCd - dt);
    if (wasDash && player.dash <= 0) player.inv = Math.max(player.inv, 0.45);
    player.inv = Math.max(0, player.inv - dt);
    if (superOn) {
      superT = Math.max(0, superT - dt);
      player.dash = Math.max(player.dash, 0.25);
      player.inv = Math.max(player.inv, 0.2);
    }

    const heldJump =
      keys.has("Space") ||
      keys.has("KeyZ") ||
      keys.has("KeyW") ||
      keys.has("ArrowUp") ||
      jumpTouch;

    if (mode === "dead") {
      player.deadT += dt;
      player.vy += g * dt;
      player.y += player.vy * dt;
      player.rot += dt * 4;
      player.squash = 1;
    } else if (superOn) {
      player.vy += 1550 * sc * dt;
      if (player.vy > 480 * sc) player.vy = 480 * sc;
      player.y += player.vy * dt;
      const ceil = H * 0.2;
      const floor = (inGap(gx) ? H * 0.72 : gy) - 10 * sc;
      if (player.y < ceil) {
        player.y = ceil;
        player.vy = Math.max(player.vy, 0);
      }
      if (player.y > floor) {
        player.y = floor;
        player.vy = Math.min(player.vy, 0);
        player.onG = true;
        player.jumps = 0;
      } else player.onG = false;
      player.rot += (Math.max(-0.35, Math.min(0.4, player.vy * 0.0005)) - player.rot) * (1 - Math.exp(-10 * dt));
      player.squash += (1 - player.squash) * (1 - Math.exp(-10 * dt));
    } else {
      const hover = player.dash > 0;
      const holdLift = heldJump && player.vy < 0 && !hover;
      if (!player.onG) player.vy += g * dt * (hover ? 0.32 : holdLift ? 0.55 : 1);
      if (player.vy > 980 * sc) player.vy = 980 * sc;
      player.y += player.vy * dt;

      const feet = player.y;
      if (!inGap(gx) && feet >= gy && player.vy >= -40) {
        if (!player.onG && player.vy > 220 * sc) {
          audio.play("land");
          burst(W * 0.22, gy, 8, 90, ["#fff5ee", "#e889b8"]);
          player.squash = 0.72;
        }
        player.y = gy;
        player.vy = 0;
        player.onG = true;
        player.jumps = 0;
        player.coyote = COYOTE;
      } else {
        if (player.onG) player.coyote = COYOTE;
        player.onG = false;
        player.coyote = Math.max(0, player.coyote - dt);
      }

      if (player.y > H + 80) {
        if (mode === "play") kill();
        else if (mode === "title") resetWorld(((Math.random() * 1e9) | 0) + 1);
      }

      const tgtRot = player.onG ? 0 : Math.max(-0.45, Math.min(0.5, player.vy * 0.00045));
      player.rot += (tgtRot - player.rot) * (1 - Math.exp(-12 * dt));
      const tgtSq = 1;
      player.squash += (tgtSq - player.squash) * (1 - Math.exp(-10 * dt));
    }

    if (!heldJump && player.vy < -400 * sc && player.dash <= 0 && !superOn && mode === "play") {
      player.vy = -400 * sc;
    }

    ensureWorld();

    const hx = gx;
    const hy = player.y - 22 * sc;
    const hw = 18 * sc;
    const hh = 16 * sc;
    const dashing = (player.dash > 0 || player.inv > 0 || superOn) && mode !== "dead";

    for (const s of stars) {
      if (!s.alive) continue;
      const dx = s.x - hx;
      const dy = s.y - hy;
      if (dx * dx + dy * dy < (32 * sc) * (32 * sc)) {
        s.alive = false;
        starN += 1;
        addScore(50, W * 0.22, player.y - 50 * sc, "+" + (50 * (1 + combo * 0.25) | 0));
        audio.play("star");
        burst(W * 0.22 + (s.x - gx), s.y, 8, 150, RB);
      }
    }

    for (const o of obs) {
      if (!o.alive) continue;
      o.y = groundAt(o.x);
      const ox = o.x;
      const oy = o.y - (o.kind === 0 ? 14 : 16) * sc;
      const ow = (o.kind === 0 ? 30 : 16) * sc;
      const oh = (o.kind === 0 ? 22 : 28) * sc;
      const hit = Math.abs(hx - ox) < hw + ow && Math.abs(hy - oy) < hh + oh;
      if (!hit) continue;
      if (dashing || mode === "title" || superOn) {
        o.alive = false;
        if (mode === "play") {
          addScore(100, W * 0.22, player.y - 60 * sc, "SMASH");
          smashN += 1;
          audio.play("smash");
          trauma = Math.min(1, trauma + 0.35);
          hitstop = reduce ? 0 : 0.03;
          player.inv = Math.max(player.inv, 0.2);
          burst(W * 0.22 + (ox - gx), oy, 10, 200, o.kind === 0 ? ["#6ec8e0", "#fff", ...RB] : RB);
        }
      } else if (mode === "play") {
        kill();
      }
    }

    const trailN = dashing && !superOn ? 3 : superOn ? 0 : 2;
    if (mode !== "dead" && (mode === "play" || mode === "title")) {
      for (let i = 0; i < trailN; i++) {
        spawnPt(
          W * 0.22 - 18 * sc - Math.random() * 22,
          player.y - 20 * sc + (Math.random() - 0.5) * 22 * sc,
          -90 - Math.random() * 110,
          (Math.random() - 0.5) * 50,
          dashing ? 0.45 : 0.28,
          (dashing ? 4.5 : 3) * sc,
          RB[(time * 16 + i) % 6 | 0],
          0,
        );
      }
      nyan.push({ wx: px(), y: player.y - 22 * sc });
      if (nyan.length > 56) nyan.splice(0, nyan.length - 56);
    }

    for (const p of pool) {
      if (!p.alive) continue;
      p.l -= dt;
      if (p.l <= 0) {
        p.alive = false;
        continue;
      }
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    for (let i = floaters.length - 1; i >= 0; i--) {
      floaters[i].t -= dt;
      floaters[i].y -= 28 * dt;
      if (floaters[i].t <= 0) floaters.splice(i, 1);
    }

    trauma = Math.max(0, trauma - dt * 1.6);
  }

  const HILL_PAL = [
    [42, 24, 64, 107, 58, 104, 232, 137, 184],
    [26, 32, 72, 61, 74, 138, 126, 160, 255],
    [20, 40, 28, 45, 107, 74, 110, 217, 160],
    [48, 20, 24, 138, 58, 64, 255, 138, 106],
    [40, 20, 48, 107, 58, 136, 200, 155, 255],
    [48, 32, 16, 138, 96, 48, 240, 193, 74],
  ];
  const DAWN_HILL = [56, 28, 36, 140, 72, 64, 240, 168, 128];

  function mixRgb(a: number[], b: number[], t: number, i: number) {
    const s = 1 - t;
    return `rgb(${(a[i] * s + b[i] * t) | 0},${(a[i + 1] * s + b[i + 1] * t) | 0},${(a[i + 2] * s + b[i + 2] * t) | 0})`;
  }

  function worldLook() {
    const clock = mode === "title" ? time : playT;
    const u = clock / 60;
    const i = u | 0;
    const f = u - i;
    const A = HILL_PAL[i % HILL_PAL.length];
    const B = HILL_PAL[(i + 1) % HILL_PAL.length];
    const dawn = Math.max(0, Math.min(1, (clock - 540) / 60));
    const nearT = mixRgb(A, B, f, 6);
    const midT = mixRgb(A, B, f, 3);
    const farT = mixRgb(A, B, f, 0);
    return {
      clock,
      dawn,
      far: dawn ? mixRgb(A, DAWN_HILL, dawn, 0) : farT,
      mid: dawn ? mixRgb(A, DAWN_HILL, dawn, 3) : midT,
      near: dawn ? mixRgb(A, DAWN_HILL, dawn, 6) : nearT,
    };
  }

  function drawHill(wxOff: number, yOff: number, fill: string, amp: number) {
    ctx.beginPath();
    ctx.moveTo(-20, H + 20);
    const step = 16;
    for (let x = -20; x <= W + 40; x += step) {
      const wx = cam * wxOff + x;
      let y: number;
      if (wxOff === 1 && inGap(cam + x)) y = H + 40;
      else {
        y =
          H * 0.72 +
          yOff +
          Math.sin(wx * 0.0068) * 26 * amp +
          Math.sin(wx * 0.017 + 1.3) * 14 * amp +
          Math.sin(wx * 0.039) * 7 * amp;
      }
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W + 40, H + 20);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function drawUnicorn(x: number, y: number) {
    const sc = H / 540;
    const g = time * speed * 0.012 + time * 8;
    const dash = player.dash > 0 && mode !== "dead";
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1 / player.squash, player.squash);
    ctx.rotate(player.rot);
    if (dash) ctx.scale(1.12, 0.92);

    const gnd = groundAt(px());
    const shadow = Math.max(0.08, 1 - Math.abs(y - gnd) / (160 * sc));
    ctx.fillStyle = `rgba(0,0,0,${0.22 * shadow})`;
    ctx.beginPath();
    ctx.ellipse(0, (gnd - y) / player.squash + 2, 22 * sc, 5 * sc, 0, 0, 7);
    ctx.fill();

    for (let i = 0; i < 6; i++) {
      ctx.strokeStyle = RB[i % 6];
      ctx.lineWidth = 3.1 * sc;
      ctx.lineCap = "round";
      ctx.beginPath();
      const w = Math.sin(g * 1.6 + i * 0.55);
      ctx.moveTo(-16 * sc, -18 * sc);
      ctx.quadraticCurveTo(
        -36 * sc - i * 2 * sc,
        -30 * sc + w * 10 * sc,
        -56 * sc - i * 3.2 * sc,
        -8 * sc + w * 16 * sc,
      );
      ctx.stroke();
    }

    const leg = (ox: number, phase: number) => {
      const a = player.onG ? Math.sin(g + phase) * 0.62 : 0.35 + Math.sin(phase) * 0.12;
      ctx.save();
      ctx.translate(ox, -6 * sc);
      ctx.rotate(a);
      ctx.fillStyle = "#fff5ee";
      ctx.fillRect(-3 * sc, 0, 6 * sc, 20 * sc);
      ctx.fillStyle = "#e889b8";
      ctx.beginPath();
      ctx.roundRect(-3.2 * sc, 18 * sc, 6.4 * sc, 5 * sc, 1.5 * sc);
      ctx.fill();
      ctx.restore();
    };
    leg(-12 * sc, 0);
    leg(-5 * sc, Math.PI);

    ctx.fillStyle = "#fff5ee";
    ctx.beginPath();
    ctx.ellipse(2 * sc, -20 * sc, 22 * sc, 14 * sc, -0.12, 0, 7);
    ctx.fill();
    ctx.fillStyle = "#f7c9d6";
    ctx.beginPath();
    ctx.ellipse(4 * sc, -16 * sc, 14 * sc, 8 * sc, -0.1, 0, 7);
    ctx.fill();

    leg(10 * sc, Math.PI);
    leg(16 * sc, 0);

    ctx.strokeStyle = "#fff5ee";
    ctx.lineWidth = 10 * sc;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(16 * sc, -26 * sc);
    ctx.quadraticCurveTo(24 * sc, -40 * sc, 30 * sc, -38 * sc);
    ctx.stroke();

    for (let i = 0; i < 7; i++) {
      ctx.strokeStyle = RB[i % 6];
      ctx.lineWidth = 2.6 * sc;
      ctx.beginPath();
      const w = Math.sin(g * 2 + i * 0.7);
      ctx.moveTo(18 * sc, -34 * sc);
      ctx.quadraticCurveTo(
        6 * sc - i * 2,
        -52 * sc + w * 6 * sc,
        -8 * sc - i * 3 * sc,
        -30 * sc + w * 12 * sc,
      );
      ctx.stroke();
    }

    ctx.fillStyle = "#fff5ee";
    ctx.beginPath();
    ctx.ellipse(34 * sc, -40 * sc, 13 * sc, 10 * sc, 0.15, 0, 7);
    ctx.fill();

    ctx.fillStyle = "#f2d6de";
    ctx.beginPath();
    ctx.ellipse(28 * sc, -49 * sc, 4 * sc, 7 * sc, -0.55, 0, 7);
    ctx.fill();
    ctx.fillStyle = "#fff5ee";
    ctx.beginPath();
    ctx.ellipse(28 * sc, -49 * sc, 2.4 * sc, 5 * sc, -0.55, 0, 7);
    ctx.fill();

    // Horn: forehead, pointing forward-up (unicorn faces +x)
    ctx.save();
    ctx.translate(44 * sc, -46 * sc);
    ctx.rotate(0.55);
    const hg = ctx.createLinearGradient(0, 6 * sc, 0, -26 * sc);
    hg.addColorStop(0, "#fff5ee");
    hg.addColorStop(0.25, "#f0c14a");
    hg.addColorStop(1, "#ffe9a0");
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.moveTo(-3.4 * sc, 6 * sc);
    ctx.lineTo(3.4 * sc, 6 * sc);
    ctx.lineTo(0.2 * sc, -26 * sc);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1.1 * sc;
    for (let i = 0; i < 4; i++) {
      const yy = -2 * sc - i * 5 * sc;
      ctx.beginPath();
      ctx.moveTo(-2 * sc, yy);
      ctx.lineTo(1.6 * sc, yy - 2 * sc);
      ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = "#1a1216";
    ctx.beginPath();
    ctx.ellipse(38 * sc, -42 * sc, 2.3 * sc, 2.6 * sc, 0, 0, 7);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(38.8 * sc, -43 * sc, 0.9 * sc, 0, 7);
    ctx.fill();

    ctx.fillStyle = "#e8b4c4";
    ctx.beginPath();
    ctx.ellipse(42 * sc, -36 * sc, 3 * sc, 1.6 * sc, 0.2, 0, 7);
    ctx.fill();

    ctx.strokeStyle = "#1a1216";
    ctx.lineWidth = 1.1 * sc;
    ctx.beginPath();
    ctx.moveTo(40 * sc, -34 * sc);
    ctx.quadraticCurveTo(44 * sc, -32 * sc, 46 * sc, -34 * sc);
    ctx.stroke();

    if (dash) {
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = "rgba(255,180,220,0.35)";
      ctx.lineWidth = 8 * sc;
      ctx.beginPath();
      ctx.ellipse(2 * sc, -22 * sc, 30 * sc, 20 * sc, 0, 0, 7);
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
    }

    ctx.restore();
  }

  function drawDolphin(x: number, y: number) {
    const sc = H / 540;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(time * 7 + x * 0.01) * 0.18 - 0.25);
    ctx.fillStyle = "#6ec8e0";
    ctx.beginPath();
    ctx.ellipse(0, 0, 20 * sc, 9 * sc, 0, 0, 7);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(16 * sc, -3 * sc);
    ctx.lineTo(30 * sc, 1 * sc);
    ctx.lineTo(16 * sc, 5 * sc);
    ctx.fill();
    ctx.fillStyle = "#3aa0c0";
    ctx.beginPath();
    ctx.moveTo(-2 * sc, -6 * sc);
    ctx.lineTo(5 * sc, -18 * sc);
    ctx.lineTo(10 * sc, -5 * sc);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-16 * sc, 0);
    ctx.lineTo(-26 * sc, -8 * sc);
    ctx.lineTo(-24 * sc, 6 * sc);
    ctx.fill();
    ctx.strokeStyle = "#1a3040";
    ctx.lineWidth = 2 * sc;
    ctx.beginPath();
    ctx.moveTo(6 * sc, -4 * sc);
    ctx.lineTo(13 * sc, -7 * sc);
    ctx.stroke();
    ctx.fillStyle = "#1a3040";
    ctx.beginPath();
    ctx.arc(11 * sc, -1 * sc, 2 * sc, 0, 7);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(11.6 * sc, -1.6 * sc, 0.7 * sc, 0, 7);
    ctx.fill();
    ctx.restore();
  }

  function drawSpike(x: number, y: number) {
    const sc = H / 540;
    // Sit below the surface so the pink hill covers the bases
    ctx.save();
    ctx.translate(x, y + 14 * sc);
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i === 1 ? "#c47a94" : "#a85a78";
      ctx.beginPath();
      const ox = (i - 1) * 9 * sc;
      ctx.moveTo(ox - 7 * sc, 0);
      ctx.lineTo(ox, -36 * sc - (i === 1 ? 6 : 0) * sc);
      ctx.lineTo(ox + 7 * sc, 0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function render() {
    const sc = H / 540;
    let sx = 0;
    let sy = 0;
    if (trauma > 0 && !reduce) {
      const mag = trauma * trauma * 11;
      sx = (Math.random() * 2 - 1) * mag;
      sy = (Math.random() * 2 - 1) * mag;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(sx, sy);

    const look = worldLook();
    const k = `${H}|${look.dawn.toFixed(2)}|${(look.clock / 8) | 0}`;
    if (!skyGrad || skyH !== H || skyKey !== k) {
      skyH = H;
      skyKey = k;
      skyGrad = ctx.createLinearGradient(0, 0, 0, H);
      const d = look.dawn;
      skyGrad.addColorStop(0, mixRgb([7, 5, 16], [26, 72, 140], d, 0));
      skyGrad.addColorStop(0.45, mixRgb([22, 16, 40], [255, 138, 92], d, 0));
      skyGrad.addColorStop(0.78, mixRgb([74, 36, 80], [255, 196, 120], d, 0));
      skyGrad.addColorStop(1, mixRgb([196, 92, 122], [255, 232, 196], d, 0));
    }
    ctx.fillStyle = skyGrad;
    ctx.fillRect(-20, -20, W + 40, H + 40);

    const moonX = W * (0.9 - look.clock * 0.0005);
    const moonY = H * (0.13 + Math.sin(look.clock * 0.045) * 0.05 + look.dawn * 0.42);
    if (look.dawn < 0.95) {
      ctx.globalAlpha = 1 - look.dawn;
      ctx.fillStyle = "#f8e8c0";
      ctx.beginPath();
      ctx.arc(moonX, moonY, 38 * sc, 0, 7);
      ctx.fill();
      ctx.fillStyle = "rgba(248,232,192,0.12)";
      ctx.beginPath();
      ctx.arc(moonX, moonY, 70 * sc, 0, 7);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (look.dawn > 0.15) {
      const sunX = W * (0.18 + look.dawn * 0.12);
      const sunY = H * (0.62 - look.dawn * 0.42);
      ctx.globalAlpha = Math.min(1, look.dawn * 1.4);
      ctx.fillStyle = "#ffd27a";
      ctx.beginPath();
      ctx.arc(sunX, sunY, 44 * sc, 0, 7);
      ctx.fill();
      ctx.fillStyle = "rgba(255,180,80,0.18)";
      ctx.beginPath();
      ctx.arc(sunX, sunY, 90 * sc, 0, 7);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.globalAlpha = 1 - look.dawn * 0.92;
    for (const s of skyStars) {
      ctx.fillStyle = "#fff8e8";
      const x = ((s.x * W - cam * 0.08) % W + W) % W;
      ctx.beginPath();
      ctx.arc(x, s.y * H, s.r, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    drawHill(0.25, 50, look.far, 0.55);
    drawHill(0.5, 28, look.mid, 0.75);
    for (const o of obs) {
      if (!o.alive || o.kind !== 1) continue;
      const ox = o.x - cam;
      if (ox < -50 || ox > W + 50) continue;
      drawSpike(ox, groundAt(o.x));
    }
    drawHill(1, 0, look.near, 1);

    ctx.strokeStyle = "rgba(255,230,245,0.65)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    let pen = false;
    for (let x = -20; x <= W + 40; x += 12) {
      if (inGap(cam + x)) {
        pen = false;
        continue;
      }
      const y = groundAt(cam + x);
      if (!pen) {
        ctx.moveTo(x, y);
        pen = true;
      } else ctx.lineTo(x, y);
    }
    ctx.stroke();

    for (const p of pool) {
      if (!p.alive) continue;
      const a = p.l / p.m;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (0.6 + 0.4 * a), 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const s of stars) {
      if (!s.alive) continue;
      const sx_ = s.x - cam;
      if (sx_ < -40 || sx_ > W + 40) continue;
      const bob = Math.sin(time * 4 + s.x * 0.02) * 5;
      ctx.save();
      ctx.translate(sx_, s.y + bob);
      ctx.rotate(time * 1.6 + s.x * 0.01);
      ctx.fillStyle = "#ffe56b";
      starPath(ctx, 9 * sc);
      ctx.fill();
      ctx.fillStyle = "#fff8d0";
      starPath(ctx, 4 * sc);
      ctx.fill();
      ctx.restore();
    }

    for (const o of obs) {
      if (!o.alive || o.kind !== 0) continue;
      const ox = o.x - cam;
      if (ox < -50 || ox > W + 50) continue;
      drawDolphin(ox, groundAt(o.x) - 8 * sc);
    }

    if (superT > 0 && nyan.length > 1) {
      ctx.lineCap = "butt";
      ctx.lineJoin = "round";
      const band = 7 * sc;
      for (let b = 0; b < 6; b++) {
        ctx.beginPath();
        ctx.strokeStyle = RB[b];
        ctx.lineWidth = band + 0.6;
        let pen = false;
        for (let i = 0; i < nyan.length; i++) {
          const x = nyan[i].wx - cam;
          const y = nyan[i].y - 18 * sc + b * band;
          if (x < -40) {
            pen = false;
            continue;
          }
          if (!pen) {
            ctx.moveTo(x, y);
            pen = true;
          } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }

    drawUnicorn(W * 0.22, player.y);

    if (player.dash > 0 && mode !== "dead") {
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = superT > 0 ? "rgba(255,180,80,0.1)" : "rgba(255,120,180,0.06)";
      ctx.fillRect(-20, -20, W + 40, H + 40);
      ctx.globalCompositeOperation = "source-over";
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  let dpr = 1;
  let skyGrad: CanvasGradient | null = null;
  let skyH = 0;
  let skyKey = "";
  function resize() {
    const r = canvas.getBoundingClientRect();
    W = Math.max(320, r.width || window.innerWidth);
    H = Math.max(240, r.height || window.innerHeight);
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    skyGrad = null;
  }

  function loop(now: number) {
    if (!last) last = now;
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1;
    if (hitstop > 0) {
      hitstop -= dt;
    } else {
      acc += dt;
      while (acc >= STEP) {
        update(STEP);
        acc -= STEP;
      }
    }
    render();
    hudT += dt;
    if (hudT > 0.12) {
      hudT = 0;
      emitHud();
    }
    raf = requestAnimationFrame(loop);
  }

  const GAME_KEYS = new Set([
    "Space",
    "ArrowUp",
    "ArrowDown",
    "KeyW",
    "KeyZ",
    "KeyX",
    "KeyK",
    "KeyP",
    "KeyM",
    "ShiftLeft",
    "ShiftRight",
    "Enter",
    "KeyJ",
  ]);

  function onKeyDown(e: KeyboardEvent) {
    if (e.repeat) return;
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    keys.add(e.code);
    audio.unlock();
    if (e.code === "KeyM") {
      muted = !muted;
      audio.setMuted(muted);
      emitHud();
      return;
    }
    if (e.code === "KeyP") {
      if (mode === "play") {
        mode = "pause";
        emitHud();
      } else if (mode === "pause") {
        mode = "play";
        emitHud();
      }
      return;
    }
    if (e.code === "Escape") {
      toTitle();
      return;
    }
    if (e.code === "Enter") {
      if (mode === "title") start();
      else if (mode === "pause") {
        mode = "play";
        emitHud();
      }
      return;
    }
    if (e.code === "Space" || e.code === "KeyZ" || e.code === "KeyW" || e.code === "ArrowUp") doJump();
    if (e.code === "KeyX" || e.code === "ShiftLeft" || e.code === "ShiftRight" || e.code === "KeyK" || e.code === "KeyJ")
      doDash();
  }
  function onKeyUp(e: KeyboardEvent) {
    keys.delete(e.code);
  }
  function onBlur() {
    keys.clear();
  }
  function onVis() {
    if (document.hidden) {
      if (mode === "play") {
        mode = "pause";
        emitHud();
      }
      audio.suspend();
    } else audio.resume();
  }

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  resize();
  resetWorld(2026);
  player.y = groundAt(px());
  emitHud();
  raf = requestAnimationFrame(loop);

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVis);
  function onPtr() {
    audio.unlock();
  }
  canvas.addEventListener("pointerdown", onPtr);

  return {
    start,
    restart,
    toTitle,
    pause() {
      if (mode === "play") {
        mode = "pause";
        emitHud();
      }
    },
    resume() {
      if (mode === "pause") {
        mode = "play";
        emitHud();
      }
    },
    jump: doJump,
    dash: doDash,
    jumpHold(v: boolean) {
      jumpTouch = v;
    },
    unlock() {
      audio.unlock();
    },
    toggleMute() {
      audio.unlock();
      muted = !muted;
      audio.setMuted(muted);
      emitHud();
    },
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("pointerdown", onPtr);
      audio.destroy();
    },
  };
}
