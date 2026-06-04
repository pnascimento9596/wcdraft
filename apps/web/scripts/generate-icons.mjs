/*
 * Rasterises the wcdraft app icons into apps/web/public/ using sharp (already a
 * transitive dependency of Next.js). Run from the repo root or apps/web:
 *
 *   node apps/web/scripts/generate-icons.mjs
 *
 * The mark is original — a stylised football inside a draft bracket on a
 * vintage-scarlet field — and contains no FIFA / World Cup trademark.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "public");

// sharp ships as a transitive dep of Next.js; pnpm does not hoist it to a
// top-level node_modules, so resolve it explicitly from the workspace root.
const require = createRequire(import.meta.url);
async function loadSharp() {
  try {
    return (await import("sharp")).default;
  } catch {
    const { globSync } = require("node:fs");
    const root = join(here, "..", "..", "..", "node_modules", ".pnpm");
    const matches = globSync("sharp@*/node_modules/sharp/lib/index.js", { cwd: root });
    if (!matches.length) throw new Error("sharp not found; run `pnpm install` first");
    return (await import(pathToFileURL(join(root, matches[0])).href)).default;
  }
}
const sharp = await loadSharp();

const SCARLET = "#c2402a";
const CREAM = "#f4eedd";

/** Build the icon SVG. `pad` is the fraction of the canvas kept as safe margin. */
function svg({ size, pad, rounded }) {
  const s = size;
  const inner = s * (1 - pad * 2);
  const cx = s / 2;
  const cy = s / 2;
  const r = inner / 2;
  const radius = rounded ? s * 0.22 : 0;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <rect width="${s}" height="${s}" rx="${radius}" ry="${radius}" fill="${SCARLET}"/>
  <g transform="translate(${cx} ${cy})" stroke="${CREAM}" fill="none" stroke-linecap="round">
    <circle r="${r}" stroke-width="${s * 0.045}"/>
    <path d="M0 ${-r * 0.46} L ${r * 0.44} ${-r * 0.13} L ${r * 0.27} ${r * 0.42} L ${-r * 0.27} ${r * 0.42} L ${-r * 0.44} ${-r * 0.13} Z" fill="${CREAM}" stroke="none"/>
    <g stroke-width="${s * 0.03}">
      <path d="M0 ${-r * 0.46} V ${-r}"/>
      <path d="M ${r * 0.44} ${-r * 0.13} L ${r * 0.86} ${-r * 0.45}"/>
      <path d="M ${-r * 0.44} ${-r * 0.13} L ${-r * 0.86} ${-r * 0.45}"/>
      <path d="M ${r * 0.27} ${r * 0.42} L ${r * 0.5} ${r * 0.82}"/>
      <path d="M ${-r * 0.27} ${r * 0.42} L ${-r * 0.5} ${r * 0.82}"/>
      <path d="M0 ${r * 0.42} V ${r * 0.95}"/>
    </g>
  </g>
</svg>`;
}

async function render(name, opts) {
  const buf = Buffer.from(svg(opts));
  await sharp(buf).png().toFile(join(outDir, name));
  console.log("wrote", name);
}

await render("icon-192.png", { size: 192, pad: 0.16, rounded: true });
await render("icon-512.png", { size: 512, pad: 0.16, rounded: true });
await render("icon-maskable-512.png", { size: 512, pad: 0.26, rounded: false });
await render("apple-touch-icon.png", { size: 180, pad: 0.16, rounded: true });

// Next.js serves the browser favicon + apple-touch icon from app/icon.png and
// app/apple-icon.png (file conventions); copy the rendered PNGs there too.
await sharp(Buffer.from(svg({ size: 512, pad: 0.16, rounded: true })))
  .png()
  .toFile(join(here, "..", "app", "icon.png"));
await sharp(Buffer.from(svg({ size: 180, pad: 0.16, rounded: true })))
  .png()
  .toFile(join(here, "..", "app", "apple-icon.png"));
console.log("wrote app/icon.png + app/apple-icon.png");
