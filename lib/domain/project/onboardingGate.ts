/** Whether to show the (non-dismissable) new-user onboarding modal.
 *
 * It used to key on the error string "No active project" alone, which also
 * fires for a user who HAS projects but no active pointer: they got the
 * new-user modal and were forced to create another project. Gate on what is
 * actually true: no projects at all. */
export function needsOnboarding(input: {
  projectsCount: number;
  activeProjectId: string | null | undefined;
  error: string | null | undefined;
  /** Still loading: never show the modal yet. */
  loading?: boolean;
}): boolean {
  if (input.loading) return false;
  if (input.projectsCount > 0) return false;
  if (input.activeProjectId) return false;
  return input.error === "No active project";
}
