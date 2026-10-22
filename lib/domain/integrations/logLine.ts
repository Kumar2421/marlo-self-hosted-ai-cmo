const WARNING = "⚠";

/** True when the status line text starts with the warning sign (a failure, not progress or success). */
export function isWarningText(text: string): boolean {
  return text.trimStart().startsWith(WARNING);
}

/** A "done" status line that starts with the warning sign is a failure, not a success. */
export function doneLineType(text: string): "done" | "error" {
  return isWarningText(text) ? "error" : "done";
}

/** The one place a log line's type is decided: any warning-prefixed line is an error, whichever helper logged it. */
export function lineType(text: string, base: "cmd" | "done"): "cmd" | "done" | "error" {
  return isWarningText(text) ? "error" : base;
}

/** Text of an error line without its leading warning sign (the row draws its own icon). */
export function stripWarning(text: string): string {
  return text.replace(/^\s*⚠\s*/, "");
}
