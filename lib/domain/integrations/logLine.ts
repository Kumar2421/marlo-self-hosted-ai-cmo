/** A "done" status line that starts with the warning sign is a failure, not a success. */
export function doneLineType(text: string): "done" | "error" {
  return text.trimStart().startsWith("⚠") ? "error" : "done";
}
