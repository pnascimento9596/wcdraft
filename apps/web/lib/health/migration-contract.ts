import journal from "../../../../packages/db/migrations/meta/_journal.json";

interface JournalEntry {
  readonly idx: number;
  readonly tag: string;
  readonly when: number;
}

function readJournalEntries(): readonly JournalEntry[] {
  const entries = journal.entries as readonly JournalEntry[];
  if (entries.length === 0) {
    throw new Error("migration contract: journal has no entries");
  }
  for (const [position, entry] of entries.entries()) {
    if (entry.idx !== position || !/^\d{4}_[a-z0-9_]+$/u.test(entry.tag)) {
      throw new Error(`migration contract: invalid journal entry at index ${position.toString()}`);
    }
    if (!Number.isSafeInteger(entry.when) || entry.when <= 0) {
      throw new Error(`migration contract: invalid timestamp for ${entry.tag}`);
    }
  }
  return entries;
}

/**
 * Build-time schema contract sourced directly from Drizzle's committed
 * journal. The application currently requires the latest migration exactly;
 * keeping the shape as a range makes future expand/contract deploy windows
 * explicit instead of silently accepting skew.
 */
export const MIGRATION_JOURNAL_ENTRIES = Object.freeze(readJournalEntries());

const required = MIGRATION_JOURNAL_ENTRIES[MIGRATION_JOURNAL_ENTRIES.length - 1]!;

export const SUPPORTED_MIGRATION_RANGE = Object.freeze({
  minimum: Object.freeze({ index: required.idx, tag: required.tag }),
  maximum: Object.freeze({ index: required.idx, tag: required.tag }),
  known_migrations: MIGRATION_JOURNAL_ENTRIES.length,
});

export function journalEntryForCreatedAt(createdAt: number): JournalEntry | null {
  return MIGRATION_JOURNAL_ENTRIES.find((entry) => entry.when === createdAt) ?? null;
}
