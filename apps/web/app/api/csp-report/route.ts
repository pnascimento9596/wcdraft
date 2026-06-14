export const runtime = "edge";

const MAX_REPORT_BYTES = 16_384;
const MAX_LOG_CHARS = 4_096;

export async function POST(request: Request): Promise<Response> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const bytes = Number(contentLength);
    if (Number.isFinite(bytes) && bytes > MAX_REPORT_BYTES) {
      return new Response(null, { status: 413 });
    }
  }

  const report = await readBoundedBody(request, MAX_REPORT_BYTES);
  if (report === null) {
    return new Response(null, { status: 413 });
  }

  console.warn("csp-report", {
    content_type: request.headers.get("content-type") ?? "unknown",
    bytes: report.bytes,
    body: report.body.slice(0, MAX_LOG_CHARS),
  });
  return new Response(null, { status: 204 });
}

async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<{ bytes: number; body: string } | null> {
  const reader = request.body?.getReader();
  if (!reader) return { bytes: 0, body: "" };

  const chunks: Uint8Array[] = [];
  let bytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return { bytes, body: new TextDecoder().decode(concatChunks(chunks, bytes)) };
}

function concatChunks(chunks: readonly Uint8Array[], bytes: number): Uint8Array {
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
