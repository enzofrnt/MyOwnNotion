/**
 * Pages that a background operational drain may exchange.
 *
 * Crash recovery reads the durable queues, not the in-memory reconciler cache.
 * Walking every reconciler ever created during the session turns a visit to
 * a closed page into a permanent extra exchange on every reconnect.
 */
export function collectOperationalSyncPageIds(
  queuedPageIds: readonly string[],
  legacyPageIds: readonly string[],
  openPageIds: readonly string[],
): string[] {
  return [...new Set([...queuedPageIds, ...legacyPageIds, ...openPageIds])].sort();
}
