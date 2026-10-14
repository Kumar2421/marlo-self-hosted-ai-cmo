export type OpenedPr = { prUrl: string; branch: string; files: string[] };

export type RecordOpenedPrResult = OpenedPr & { warning?: string };

/**
 * Runs once a pull request exists on GitHub. The PR is the point of no return:
 * if recording it fails, the caller must still get the PR URL back (with a
 * warning) rather than an error that suggests nothing was opened. Returns the
 * same shape either way, and reports whether recording succeeded.
 *
 * `record` returns the PR URL the finding is now linked to. When a different PR
 * was already open for the finding, that one stays linked and the returned
 * `prUrl` is it, with a warning naming the duplicate. A record that returns
 * nothing is taken to have linked the new PR.
 */
export async function recordOpenedPr(
  opened: OpenedPr,
  record: (prUrl: string, files: string[]) => Promise<string | void>,
  onRecordError: (err: unknown) => void = () => undefined,
): Promise<RecordOpenedPrResult> {
  let tracked: string | undefined;
  try {
    tracked = (await record(opened.prUrl, opened.files)) || undefined;
  } catch (err) {
    onRecordError(err);
    return {
      ...opened,
      warning: "The pull request was opened, but Marlo could not record it. Refresh the finding before retrying.",
    };
  }
  if (tracked && tracked !== opened.prUrl) {
    return {
      ...opened,
      prUrl: tracked,
      warning: `Another open pull request already tracks this finding. Marlo kept ${tracked}; ${opened.prUrl} is a duplicate and can be closed.`,
    };
  }
  return { ...opened };
}
