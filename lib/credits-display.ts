/**
 * Pure view-model for the credits numbers shown in Settings > Credits and
 * the header. Kept free of React and path aliases so node tests can import it.
 *
 * During beta (billing not enforced) usage is still recorded, so `balance`
 * can go below `granted`. The allowance ("N / granted") and the progress bar
 * only mean something once billing is enforced, and a bar never shows usage
 * above the allowance.
 */

export const BETA_UNLIMITED_LABEL = "Unlimited during beta";

export type CreditsDisplayInput = {
  balance: number;
  granted: number;
  billingEnabled: boolean;
};

export type CreditsDisplay = {
  /** Credits consumed so far. Never negative. */
  used: number;
  usedLabel: string;
  /** Shown after the used count ("/ 20"). Null in beta or when no allowance is known. */
  allowanceLabel: string | null;
  /** Bar fill from 0 to 100, or null when no bar should render. */
  barPercent: number | null;
  /** The "Credits remaining" value. */
  remainingLabel: string;
};

export function creditsDisplay({ balance, granted, billingEnabled }: CreditsDisplayInput): CreditsDisplay {
  const used = Math.max(granted - balance, 0);
  const hasAllowance = billingEnabled && granted > 0;
  const withinAllowance = hasAllowance && used <= granted;
  return {
    used,
    usedLabel: used.toLocaleString(),
    allowanceLabel: hasAllowance ? granted.toLocaleString() : null,
    barPercent: withinAllowance ? (used / granted) * 100 : null,
    remainingLabel: billingEnabled ? balance.toLocaleString() : BETA_UNLIMITED_LABEL,
  };
}
