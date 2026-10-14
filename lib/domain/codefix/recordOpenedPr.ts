export type OpenedPr = { prUrl: string; branch: string; files: string[] };

export type RecordOpenedPrResult = OpenedPr & { warning?: string };

/**
 * Runs once a pull request exists on GitHub. The PR is the point of no return:
 * if recording it fails, the caller must still get the PR URL back (with a
 * warning) rather than an error that suggests nothing was opened. Returns the
 * same shape either way, and reports whether recording succeeded.
 */
export async function recordOpenedPr(
  opened: OpenedPr,
  record: (prUrl: string, files: string[]) => Promise<void>,
  onRecordError: (err: unknown) => void = () => undefined,
): Promise<RecordOpenedPrResult> {
  try {
    await record(opened.prUrl, opened.files);
    return { ...opened };
  } catch (err) {
    onRecordError(err);
    return {
      ...opened,
      warning: "The pull request was opened, but Marlo could not record it. Refresh the finding before retrying.",
    };
  }
}
