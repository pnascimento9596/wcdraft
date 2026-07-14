export type BoundedTextResult =
  | { readonly status: "ok"; readonly value: string }
  | { readonly status: "too_large" }
  | { readonly status: "invalid" };

/** Read a request body with an actual streaming byte ceiling. */
export async function readBoundedText(
  request: Request,
  maxBytes: number,
): Promise<BoundedTextResult> {
  const body = request.body;
  if (!body) return { status: "ok", value: "" };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { status: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { status: "invalid" };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { status: "ok", value: new TextDecoder().decode(bytes) };
}
