import { minify } from "terser";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pub = join(root, "public");
const htmlOut = join(pub, "jam.html");
const zipOut = join(pub, "rua.zip");

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

mkdirSync(pub, { recursive: true });
writeFileSync(htmlOut, html);
writeFileSync(join(root, "jam", "index.min.html"), html);

execSync(`python3 - <<'PY'
import zipfile, os
z = zipfile.ZipFile(${JSON.stringify(zipOut)}, 'w', zipfile.ZIP_DEFLATED, compresslevel=9)
z.writestr('index.html', open(${JSON.stringify(htmlOut)}).read())
z.close()
print('html', os.path.getsize(${JSON.stringify(htmlOut)}))
print('zip', os.path.getsize(${JSON.stringify(zipOut)}))
PY`, { stdio: "inherit" });

const zipSize = statSync(zipOut).size;
console.log("zip bytes", zipSize, "limit 13312", zipSize < 13312 ? "OK" : "OVER");
console.log("deflate estimate", deflateSync(Buffer.from(html), { level: 9 }).length);
