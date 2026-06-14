"use client";

// Last-resort error boundary. Next renders this in place of the ENTIRE root
// layout (its own <html>/<body>), so the shell + globals.css are not available
// here — styles are inlined to guarantee a readable, on-brand page even when
// everything else has failed. Mirrors the dark-theme tokens from layout.tsx.
const wrap: React.CSSProperties = {
  margin: 0,
  minHeight: "100dvh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#0c1411",
  color: "#efe9db",
  fontFamily: "system-ui, -apple-system, sans-serif",
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
  fontWeight: 600,
  textDecoration: "none",
  cursor: "pointer",
};

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={wrap}>
        <div style={{ maxWidth: "34rem" }}>
          <p
            style={{
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontSize: "0.78rem",
              color: "#2ecf92",
              margin: "0 0 0.5rem",
            }}
          >
            Something went wrong
          </p>
          <h1 style={{ fontSize: "1.75rem", lineHeight: 1.15, margin: "0 0 0.75rem" }}>
            The match was abandoned
          </h1>
          <p style={{ opacity: 0.82, margin: "0 0 1.5rem", lineHeight: 1.55 }}>
            An unexpected error interrupted the page. You can try again, or head back to start a
            fresh run.
          </p>
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{ ...btn, background: "#2ecf92", color: "#0c1411", border: "none" }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{ ...btn, background: "transparent", color: "#efe9db", border: "1px solid #3a4a40" }}
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
