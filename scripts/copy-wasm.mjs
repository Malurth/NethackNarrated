import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.join(projectRoot, "public");

// Both versions come from npm packages.
const versions = [
  { pkg: "@neth4ck/wasm-367", wasmDest: "nethack-367.wasm", jsDest: "nethack-367.js" },
  { pkg: "@neth4ck/wasm-37",  wasmDest: "nethack-37.wasm",  jsDest: "nethack-37.js" },
];

for (const { pkg, wasmDest, jsDest } of versions) {
  const buildDir = path.join(projectRoot, "node_modules", ...pkg.split("/"), "build");
  for (const { src, dest } of [
    { src: "nethack.wasm", dest: wasmDest },
    { src: "nethack.js", dest: jsDest },
  ]) {
    const srcPath = path.join(buildDir, src);
    const destPath = path.join(publicDir, dest);
    if (!fs.existsSync(srcPath)) {
      console.warn(`Missing ${pkg} asset: ${srcPath} — skipping`);
      continue;
    }
    fs.copyFileSync(srcPath, destPath);
    const size = (fs.statSync(destPath).size / 1024 / 1024).toFixed(1);
    console.log(`Copied ${dest} (${size} MB)`);
  }
}
