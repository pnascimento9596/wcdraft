#!/usr/bin/env node
/**
 * Writes the minimal Capacitor webDir placeholder.
 *
 * When `server.url` is set (production hybrid mode), Capacitor still
 * requires a webDir on disk for sync bookkeeping. The live UI loads from
 * the configured origin; this page is only shown if the remote URL is
 * unset or unreachable during a pure-local load.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const wwwDir = join(here, "..", "www");
mkdirSync(wwwDir, { recursive: true });

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, viewport-fit=cover"
    />
    <meta name="color-scheme" content="dark light" />
    <title>wcdraft</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0a0e13;
        --ink: #e8efe9;
        --muted: #8aa396;
        --accent: #2ecf92;
      }
      html,
      body {
        margin: 0;
        min-height: 100%;
        background: var(--bg);
        color: var(--ink);
        font-family:
          "Space Grotesk",
          system-ui,
          -apple-system,
          sans-serif;
      }
      main {
        box-sizing: border-box;
        min-height: 100svh;
        min-height: 100dvh;
        display: grid;
        place-items: center;
        padding:
          max(1.5rem, env(safe-area-inset-top, 0px))
          max(1.5rem, env(safe-area-inset-right, 0px))
          max(1.5rem, env(safe-area-inset-bottom, 0px))
          max(1.5rem, env(safe-area-inset-left, 0px));
        text-align: center;
      }
      h1 {
        margin: 0 0 0.5rem;
        font-size: 1.5rem;
        letter-spacing: 0.02em;
        color: var(--accent);
      }
      p {
        margin: 0;
        max-width: 28rem;
        color: var(--muted);
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <main>
      <div>
        <h1>wcdraft</h1>
        <p>
          Native shell placeholder. The iOS wrapper loads the production PWA
          origin for full product parity (auth, leaderboard, offline SW).
        </p>
      </div>
    </main>
  </body>
</html>
`;

writeFileSync(join(wwwDir, "index.html"), html, "utf8");
console.log("wrote apps/mobile/www/index.html");
