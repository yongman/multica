import { hashKey, type QueryClient, type QueryKey } from "@tanstack/react-query";

const scheduled = new WeakMap<QueryClient, Map<string, Promise<void>>>();

/**
 * WS dispatch calls every observer synchronously. Merge their requests before
 * starting a backfill, but let the next event replace an unfinished snapshot.
 */
export function refreshQuery(qc: QueryClient, queryKey: QueryKey): Promise<void> {
  let batch = scheduled.get(qc);
  if (!batch) {
    batch = new Map();
    scheduled.set(qc, batch);
  }
  const hash = hashKey(queryKey);
  const existing = batch.get(hash);
  if (existing) return existing;

  const filters = { queryKey, exact: true };
  const query = qc.getQueryCache().find(filters);
  const refresh = Promise.resolve().then(async () => {
    // Coalesce one dispatch, not the whole HTTP lifetime: a later terminal
    // event or reconnect must replace a request that predates its data.
    batch.delete(hash);
    if (qc.getQueryCache().find(filters) !== query) return;
    // Invalidation alone reuses an unfinished first load. Preserve WS rows
    // while cancelling it, and avoid touching a cleared/replaced session.
    await qc.cancelQueries(filters, { revert: false, silent: true });
    if (qc.getQueryCache().find(filters) === query) await qc.invalidateQueries(filters);
  });
  batch.set(hash, refresh);
  return refresh;
}
