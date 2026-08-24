import { minify } from "terser";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { execSync } from "node:child_process";

const js = readFileSync(new URL("./src.js", import.meta.url), "utf8");
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

const html = `<!DOCTYPE html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1,user-scalable=no"><title>Robot Unicorn</title><style>html,body{margin:0;height:100%;background:#0b0614;overflow:hidden;touch-action:none}canvas{display:block;width:100%;height:100%}</style><canvas></canvas><script>${result.code}</script>`;

mkdirSync("/workspace/public", { recursive: true });
writeFileSync("/workspace/public/jam.html", html);
writeFileSync("/workspace/jam/index.min.html", html);

execSync("python3 - <<'PY'\nimport zipfile\nz=zipfile.ZipFile('/workspace/public/rua.zip','w',zipfile.ZIP_DEFLATED,compresslevel=9)\nz.writestr('index.html', open('/workspace/public/jam.html').read())\nz.close()\nimport os\nprint('html', os.path.getsize('/workspace/public/jam.html'))\nprint('zip', os.path.getsize('/workspace/public/rua.zip'))\nPY");

const zipSize = (await import("node:fs")).statSync("/workspace/public/rua.zip").size;
console.log("zip bytes", zipSize, "limit 13312", zipSize < 13312 ? "OK" : "OVER");
console.log("deflate estimate", deflateSync(Buffer.from(html), { level: 9 }).length);
