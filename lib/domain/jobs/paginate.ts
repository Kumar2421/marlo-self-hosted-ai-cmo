/**
 * Helpers for cron selection queries.
 *
 * PostgREST answers at most 1000 rows per request (the default max-rows), and a
 * long `.in(column, ids)` list makes the request URL too long to send. Both
 * fail without any visible symptom: the first truncates silently, the second is
 * an error that callers tend to ignore. These helpers make the reads safe.
 */

/** PostgREST's default max-rows. */
export const DEFAULT_PAGE_SIZE = 1000;
/** Upper bound on rows read by one fetchAllPages call. */
export const DEFAULT_MAX_ROWS = 20_000;
/** Ids per `.in()` list: 200 UUIDs is about 8 KB of query string, far under proxy header limits. */
export const DEFAULT_CHUNK_SIZE = 200;

export type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Every row of a query, read with `.range(from, to)` one page at a time.
 *
 * `fetchPage(from, to)` must build an ordered, ranged query, ordered by a unique
 * column (or a unique combination), so consecutive ranges never repeat or skip a
 * row. The cursor advances by the rows actually returned and only an empty page
 * ends the read, so a server that answers with fewer rows than asked for (a lower
 * max-rows) cannot make a read stop early. Throws on the first error: a partial
 * list must never pass for a complete one. Stops at `max` rows and logs a warning
 * when that cap, not the end of the data, ended the read.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize: number = DEFAULT_PAGE_SIZE,
  max: number = DEFAULT_MAX_ROWS,
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error("pageSize must be a positive integer.");
  const rows: T[] = [];
  let from = 0;
  while (from < max) {
    const to = Math.min(from + pageSize, max) - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) throw new Error(error.message);
    const got = data ?? [];
    if (got.length === 0) return rows;
    rows.push(...got);
    from += got.length;
  }
  console.warn(`[paginate] stopped at the ${max}-row cap; the result may be incomplete.`);
  return rows;
}

/** Splits `items` into consecutive arrays of at most `size`; no empty arrays. */
export function chunk<T>(items: readonly T[], size: number = DEFAULT_CHUNK_SIZE): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error("chunk size must be a positive integer.");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Runs `fn` over each chunk of `items`, up to `concurrency` chunks at a time, and returns the
 * results in chunk order. `fn` should handle its own errors; a throw rejects the whole call.
 */
export async function mapChunks<T, R>(
  items: readonly T[],
  size: number,
  fn: (part: T[], index: number) => Promise<R>,
  concurrency = 4,
): Promise<R[]> {
  const parts = chunk(items, size);
  const results: R[] = new Array(parts.length);
  let next = 0;
  const worker = async () => {
    while (next < parts.length) {
      const index = next++;
      results[index] = await fn(parts[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, parts.length)) }, worker));
  return results;
}
