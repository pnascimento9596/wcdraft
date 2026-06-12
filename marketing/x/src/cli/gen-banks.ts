// CLI: (re)generate the committed reply-bank.md + quote-bank.md from the typed
// bank data. Run after editing src/pack/banks.ts.
//
//   pnpm gen:banks

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { PACKAGE_ROOT } from "../paths.ts";
import { renderQuoteBank, renderReplyBank } from "../pack/render-banks.ts";

const reply = join(PACKAGE_ROOT, "reply-bank.md");
const quote = join(PACKAGE_ROOT, "quote-bank.md");
writeFileSync(reply, renderReplyBank(), "utf8");
writeFileSync(quote, renderQuoteBank(), "utf8");
console.log(`wrote ${reply}`);
console.log(`wrote ${quote}`);
