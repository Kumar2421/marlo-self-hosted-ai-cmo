/**
 * "Send this report" links for the person who ran an audit (often for a client's site). They are plain links that
 * open the person's own WhatsApp or mail app with a short message already written. Marlo never sends anything.
 */

export type ShareMessage = { host: string; score: number; url: string };

/** One short, honest line: what was checked, the score, and the link. No promises about rankings. */
export function shareText({ host, score, url }: ShareMessage): string {
  return `Website audit for ${host}: ${score}/100 on the on-page checks, with the top fixes to make first. ${url}`;
}

export function whatsappShareLink(message: ShareMessage): string {
  return `https://wa.me/?text=${encodeURIComponent(shareText(message))}`;
}

export function emailShareLink(message: ShareMessage): string {
  const subject = `Website audit for ${message.host}`;
  const body = `Hi,\n\nI ran a quick audit of ${message.host}. It scored ${message.score}/100 on the on-page checks, and the report lists the top fixes to make first:\n\n${message.url}\n`;
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
