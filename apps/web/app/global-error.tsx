"use client";

// Last-resort error boundary. Next renders this in place of the ENTIRE root
// layout (its own <html>/<body>), so the shell + globals.css are not available
// here — styles are inlined to guarantee a readable, on-brand page even when
// everything else has failed. Mirrors the theme token hexes from globals.css.
const wrap: React.CSSProperties = {
  margin: 0,
  minHeight: "100dvh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "1.5rem",
  textAlign: "center",
};
const btn: React.CSSProperties = {
  minHeight: "44px",
  display: "inline-flex",
  alignItems: "center",
  padding: "0 1.25rem",
  borderRadius: "0.5rem",
  fontSize: "1rem",
  fontWeight: 800,
  letterSpacing: "0.02em",
  textDecoration: "none",
  cursor: "pointer",
};

const themeCss = `
@font-face {
  font-family: "Archivo";
  font-style: normal;
  font-display: swap;
  font-weight: 400;
  src: url("/fonts/archivo/archivo-latin-400-normal.woff2") format("woff2");
}
@font-face {
  font-family: "Archivo";
  font-style: normal;
  font-display: swap;
  font-weight: 500;
  src: url("/fonts/archivo/archivo-latin-500-normal.woff2") format("woff2");
}
@font-face {
  font-family: "Archivo";
  font-style: normal;
  font-display: swap;
  font-weight: 800;
  src: url("/fonts/archivo/archivo-latin-800-normal.woff2") format("woff2");
}
.global-error-body {
  --font-family: "Archivo", system-ui, sans-serif;
  --error-bg: #0f100e;
  --error-ink: #ebe6da;
  --error-accent: #3f9b68;
  --error-accent-solid: #3f9268;
  --error-accent-ink: #05130c;
  --error-line: #42493f;
  font-family: var(--font-family);
  background: var(--error-bg);
  color: var(--error-ink);
}
.global-error-eyebrow {
  color: var(--error-accent);
}
.global-error-primary {
  background: var(--error-accent-solid);
  color: var(--error-accent-ink);
  border: none;
}
.global-error-secondary {
  background: transparent;
  color: var(--error-ink);
  border: 1px solid var(--error-line);
}
@media (prefers-color-scheme: light) {
  .global-error-body {
    --error-bg: #e7e1d2;
    --error-ink: #16211a;
    --error-accent: #067044;
    --error-accent-solid: #2ecf92;
    --error-accent-ink: #06130d;
    --error-line: rgba(24, 36, 28, 0.28);
  }
}
`;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="global-error-body" style={wrap}>
        <style dangerouslySetInnerHTML={{ __html: themeCss }} />
        <div style={{ maxWidth: "34rem" }}>
          <p
            className="global-error-eyebrow"
            style={{
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              fontSize: "0.78rem",
              fontWeight: 500,
              margin: "0 0 0.5rem",
            }}
          >
            Something went wrong
          </p>
          <h1
            style={{
              fontSize: "1.75rem",
              fontWeight: 800,
              letterSpacing: "-0.02em",
              lineHeight: 1.15,
              margin: "0 0 0.75rem",
            }}
          >
            The match was abandoned
          </h1>
          <p style={{ opacity: 0.82, margin: "0 0 1.5rem", lineHeight: 1.55 }}>
            An unexpected error interrupted the page. You can try again, or head back to start a
            fresh run.
          </p>
          <div
            style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}
          >
            <button
              type="button"
              onClick={() => reset()}
              className="global-error-primary"
              style={btn}
            >
              Try again
            </button>
            <a
              href="/"
              className="global-error-secondary"
              style={{
                ...btn,
              }}
            >
              Home
            </a>
          </div>
          {error.digest ? (
            <p style={{ opacity: 0.4, fontSize: "0.7rem", marginTop: "1.5rem" }}>
              Reference: {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
