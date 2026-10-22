/**
 * Which resource stays selected when a connection's resource list is rebuilt
 * (reconnect). An explicit choice wins; otherwise the previous selection is
 * kept if Google still lists it; otherwise a single resource is auto-selected.
 */
export function chooseSelectedResourceId(
  incomingIds: string[],
  previousSelectedId: string | null | undefined,
  explicitId?: string | null,
): string | null {
  if (explicitId) return explicitId;
  if (previousSelectedId && incomingIds.includes(previousSelectedId)) return previousSelectedId;
  return incomingIds.length === 1 ? incomingIds[0] : null;
}
