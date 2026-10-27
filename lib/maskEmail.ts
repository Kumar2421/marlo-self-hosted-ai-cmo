/**
 * Shortens an email for places that are easy to screenshot: "senthil@gmail.com" -> "se…@gmail.com".
 * The domain stays visible so people can still tell which account is connected.
 * Pure (no React) so node tests cover it.
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "";
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const keep = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${keep}…@${domain}`;
}
