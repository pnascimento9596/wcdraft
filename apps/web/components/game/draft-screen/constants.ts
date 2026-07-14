export const TOTAL_SPINS = 17;

/**
 * Honest fallback copy when the run-record store is running on the in-memory
 * fallback. Kept in sync with the formation-lock and pick-lock messages so a
 * resume after `router.replace` doesn't lose the warning the user already saw.
 */
export const VOLATILE_STORAGE_WARNING =
  "Draft is saved in this tab only because browser storage is unavailable.";
