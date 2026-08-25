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

// Emit a complete document. Browsers infer html/head/body happily enough, but a
// jam host that injects its own markup by string-matching </body> finds nothing
// to match in an implicit document, and the two engines recover differently.
const html = `<!DOCTYPE html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1,user-scalable=no"><title>Tribute Unicorn Attack</title><style>html,body{margin:0;height:100%;background:#0b0614;overflow:hidden;touch-action:none}canvas{display:block;width:100%;height:100%}</style></head><body><canvas></canvas><script>${result.code}</script></body></html>`;

mkdirSync(dist, { recursive: true });
writeFileSync(htmlOut, html);

// zipfile.writestr defaults the entry to mode 0600, which is unreadable to a
// web server that extracts as one user and serves as another. Force 0644.
execSync(
  `python3 - <<'PY'
import zipfile
info = zipfile.ZipInfo('index.html', date_time=(2026, 1, 1, 0, 0, 0))
info.compress_type = zipfile.ZIP_DEFLATED
info.external_attr = (0o644 << 16) | 0o600
info.create_system = 3
z = zipfile.ZipFile(${JSON.stringify(zipOut)}, 'w', zipfile.ZIP_DEFLATED, compresslevel=9)
z.writestr(info, open(${JSON.stringify(htmlOut)}).read())
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
