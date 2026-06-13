// Render the reply bank + quote bank to copy-paste markdown.

import { TCO_LINK_LEN, X_HANDLE } from "../config.ts";
import { DISCOVERY_SEARCHES, QUOTE_BANK, REPLY_BANK, type BankScenario } from "./banks.ts";

const URL_RX = /https?:\/\/\S+/g;

/** Effective X length: any link counts as a wrapped t.co (23 chars). */
export function xLen(text: string): number {
  const links = text.match(URL_RX) ?? [];
  let len = text.length;
  for (const l of links) len += TCO_LINK_LEN - l.length;
  return len;
}

function renderScenario(scn: BankScenario): string[] {
  const out: string[] = [];
  out.push(`### ${scn.title}`);
  out.push("");
  out.push(`_${scn.guidance}_`);
  out.push("");
  scn.variants.forEach((v, i) => {
    out.push(`**Variant ${i + 1} · ${xLen(v.text)}/280 chars**`);
    out.push("");
    out.push("```");
    out.push(v.text);
    out.push("```");
    out.push("");
  });
  return out;
}

export function renderReplyBank(): string {
  const lines: string[] = [];
  lines.push(`# ${X_HANDLE} — reply bank`);
  lines.push("");
  lines.push(
    "Pre-written replies for people who contact us. Find the matching scenario, copy a variant, tweak a word if you like, and reply. Rotate variants so you don't repeat yourself. Never reply to abuse or spam — just move on.",
  );
  lines.push("");
  lines.push(
    "**Rules:** only reply to people who engaged us first · one reply per person per day · never disparage another game · never claim any affiliation.",
  );
  lines.push("");
  for (const scn of REPLY_BANK) lines.push(...renderScenario(scn));
  return lines.join("\n") + "\n";
}

export function renderQuoteBank(): string {
  const lines: string[] = [];
  lines.push(`# ${X_HANDLE} — quote-post bank + discovery links`);
  lines.push("");
  lines.push(
    "Quote-posts only (quote a public post with your own comment) — never an unsolicited @-reply to someone who hasn't engaged us. Lead with a differentiator, keep it positive, never disparage another game. Cap yourself at ~3 quote-posts/day.",
  );
  lines.push("");
  for (const scn of QUOTE_BANK) lines.push(...renderScenario(scn));

  lines.push("## Discovery — open these searches to find quote targets");
  lines.push("");
  lines.push(
    "_API search isn't available, so hunt by hand: open a link, find a good public post, and quote it with a variant above._",
  );
  lines.push("");
  for (const s of DISCOVERY_SEARCHES) lines.push(`- [${s.label}](${s.url})`);
  lines.push("");
  return lines.join("\n") + "\n";
}
