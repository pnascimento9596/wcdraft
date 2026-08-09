# Secret-scan output safety

This is the standing in-repository safety policy for every secret scan performed
by an implementation agent, reviewer, verifier, or incident responder. It
applies equally to source trees, Git objects, receipts, CI logs, task/session
records, temporary directories, and external review output.

## Non-negotiable output rule

Never run a secret comparison in a mode that prints a matching line, record,
fragment, filename containing the value, or surrounding context. A JSONL match
can place an entire credential-bearing event onto one line; ordinary `rg`,
`grep`, log-tail, or review capture can therefore create a new exposure while
trying to measure an old one.

The comparison must happen in process. The only permitted surfaced result is an
allowlisted summary containing counts and non-secret classifications, for
example:

```text
files_scanned=4702 exact_matches=0 classification=clean
```

If matches exist, report only the aggregate count and an approved surface class
such as `reachable_git`, `review_log`, `ci_log`, `receipt`, or `session_record`.
Do not print a matching path when its name embeds secret material. Never include
the compared value, its length, prefix, suffix, hash, encoded form, or a raw
matching record in stdout, stderr, a receipt, a PR body, a review, or chat.

## Scanner requirements

- Supply the exact value through protected stdin, an already-configured secret
  store, or a mode-0600 file. Never place it in command arguments, source text,
  shell history, or a generated prompt.
- Disable shell tracing before acquiring or comparing the value. Treat a
  scanner that can echo its input or raw matches as unsafe and do not run it.
- Compare bytes or exact decoded values in memory. Emit only integer counts,
  bounded non-secret scan totals, and allowlisted classifications.
- Keep candidate streams private. Redirect third-party scanner output to a
  mode-0600 temporary file and classify it without printing if the tool cannot
  guarantee count-only behavior.
- On a positive result, stop propagation first. Any quarantine, deletion,
  credential rotation, Git rewrite, or external notification still requires
  the authority and exact-target rules of the active incident lane.
- Re-scan after authorized containment with the same count-only mechanism.
  Record both counts and the bounded surface definition; do not silently replace
  the initial result.

## Reviewer rule

Review prompts must repeat this policy. A reviewer must not use raw line search
as an evidentiary shortcut, and its transcript is itself part of the scan
surface. A verdict or receipt that contains a raw secret match is invalid even
if the underlying credential was already revoked.

## Private retained-diagnostic carve-out

Raw external-tool stdout and stderr may be retained for an explicitly authorized
incident diagnosis even though they must never be surfaced. Retention is allowed
only in a mode-`0700` host directory outside the repository, receipts, CI
artifacts, and every committable path. Each retained file must be mode `0600`.
The only retained-diagnostic datum permitted in stdout, stderr, chat, a PR body,
or a report is the path itself. Never print, upload, quote, summarize by copying,
or otherwise read the file contents back into a transcript.

An explicitly authorized incident operator may inspect the file locally without
echoing it. Reviewers must not open it, reproduce it, or ask another tool to
serialize it; they verify the retention boundary through source inspection,
permissions, lifecycle checks, and credential-bearing simulations instead. A
successful verifier run removes its retained file and directory automatically.
After a failed run, the file persists only until operator inspection is complete.
The operator then removes exactly that file and its now-empty parent directory:

```bash
rm -f -- "$retained_diagnostics_path"
rmdir -- "$(dirname "$retained_diagnostics_path")"
```

This carve-out deliberately separates **retention** from **surfacing**. Do not
delete private failed-run evidence merely because raw bytes are forbidden in
output, and do not print it merely because it has been retained securely.

This repository policy is effective for wcdraft work. Adoption into the
canonical owner document set remains an explicit owner decision.
