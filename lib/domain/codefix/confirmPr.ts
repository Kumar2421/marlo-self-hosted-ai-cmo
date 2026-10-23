/** The two-click flow for opening a pull request: preview -> confirming -> submitting. Pure, so it can be tested. */
export type ConfirmStep = "preview" | "confirming" | "submitting";

/** "Approve and open PR": shows the confirmation. Nothing is sent. */
export function askConfirm(step: ConfirmStep): ConfirmStep {
  return step === "preview" ? "confirming" : step;
}

/** "Back" (or Escape): returns to the preview. Ignored while a request is in flight. */
export function backToPreview(step: ConfirmStep): ConfirmStep {
  return step === "confirming" ? "preview" : step;
}

/** "Open pull request": the only transition that sends anything, and only from confirming (so a double click sends once). */
export function confirmSubmit(step: ConfirmStep): { step: ConfirmStep; send: boolean } {
  return step === "confirming" ? { step: "submitting", send: true } : { step, send: false };
}

/** A failed request returns to the confirmation so the error shows and the user can retry or go back. */
export function submitFailed(step: ConfirmStep): ConfirmStep {
  return step === "submitting" ? "confirming" : step;
}
