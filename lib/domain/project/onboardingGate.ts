/** Whether to show the (non-dismissable) new-user onboarding modal.
 *
 * Decided from the project list alone (GET /api/project), as soon as it has
 * loaded, instead of waiting for the later /api/project/data request to fail.
 *
 * Safety rules:
 * - A user who HAS projects but no active pointer never gets the modal (they
 *   used to be forced to create another project).
 * - "No projects" counts only when the list request actually succeeded
 *   (`projectsLoaded`): a 500, network error or signed-out/stale store never
 *   shows it. */
export function needsOnboarding(input: {
  projectsCount: number;
  activeProjectId: string | null | undefined;
  /** The project list request succeeded (see ProjectProvider.projectsLoaded). */
  projectsLoaded: boolean;
  /** Still loading: never show the modal yet. */
  loading?: boolean;
}): boolean {
  if (input.loading) return false;
  if (!input.projectsLoaded) return false;
  if (input.projectsCount > 0) return false;
  if (input.activeProjectId) return false;
  return true;
}
