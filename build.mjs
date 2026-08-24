// Builds the js13k submission: minify src.js, inline it into a single HTML
// file, zip that, and report the size against the 13312-byte competition cap.
import { minify } from "terser";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const LIMIT = 13312;
const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
const htmlOut = join(dist, "index.html");
const zipOut = join(dist, "rua.zip");

const js = readFileSync(join(root, "src.js"), "utf8");
const result = await minify(js, {
  compress: {
    passes: 3,
    unsafe: true,
    unsafe_math: true,
    pure_getters: true,
    drop_console: true,
  },
  mangle: { toplevel: true },
  format: { comments: false },
});
if (!result.code) throw new Error("minify failed");

const html = `<!DOCTYPE html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1,user-scalable=no"><title>Tribute Unicorn Attack</title><style>html,body{margin:0;height:100%;background:#0b0614;overflow:hidden;touch-action:none}canvas{display:block;width:100%;height:100%}</style><canvas></canvas><script>${result.code}</script>`;

mkdirSync(dist, { recursive: true });
writeFileSync(htmlOut, html);

execSync(
  `python3 - <<'PY'
import zipfile, os
z = zipfile.ZipFile(${JSON.stringify(zipOut)}, 'w', zipfile.ZIP_DEFLATED, compresslevel=9)
z.writestr('index.html', open(${JSON.stringify(htmlOut)}).read())
z.close()
PY`,
  { stdio: "inherit" },
);

const zipSize = statSync(zipOut).size;
const pct = ((zipSize / LIMIT) * 100).toFixed(1);
console.log(`html  ${statSync(htmlOut).size} bytes`);
console.log(`zip   ${zipSize} / ${LIMIT} bytes  (${pct}%, ${LIMIT - zipSize} left)  ${zipSize < LIMIT ? "OK" : "OVER"}`);
console.log(`deflate estimate ${deflateSync(Buffer.from(html), { level: 9 }).length}`);
if (zipSize >= LIMIT) process.exit(1);
