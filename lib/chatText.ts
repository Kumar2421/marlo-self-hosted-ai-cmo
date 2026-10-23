/**
 * Turns an assistant reply (plain text, possibly with list-ish lines) into blocks the chat can draw
 * consistently. Models write "1.", "1)", "-", "*", a bullet dot or even "**bold**"; all become one
 * look. Pure (no React) so node tests cover it.
 */
export type ChatBlock =
  | { kind: "p"; text: string }
  | { kind: "ol"; items: string[] }
  | { kind: "ul"; items: string[] };

const OL = /^\s{0,6}\d{1,3}[.)]\s+(.*\S)\s*$/;
const UL = /^\s{0,6}[-*•–]\s+(.*\S)\s*$/;

/** Strips markdown emphasis/heading/code markers that the chat does not render. */
export function stripInlineMarkdown(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/, "");
}

export function parseChatText(text: string): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  const para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", text: stripInlineMarkdown(para.join(" ")) });
    para.length = 0;
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(raw)) { flush(); continue; }
    const ol = OL.exec(raw);
    const ul = ol ? null : UL.exec(raw);
    const m = ol ?? ul;
    if (m) {
      flush();
      const kind = ol ? "ol" : "ul";
      const last = blocks[blocks.length - 1];
      const item = stripInlineMarkdown(m[1]);
      if (last && last.kind === kind) last.items.push(item);
      else blocks.push({ kind, items: [item] });
    } else if (!raw.trim()) {
      flush();
    } else if (/^\s{2,}\S/.test(raw) && blocks[blocks.length - 1] && para.length === 0 && blocks[blocks.length - 1].kind !== "p") {
      // Indented continuation of the previous list item (wrapped line).
      const last = blocks[blocks.length - 1] as { items: string[] };
      last.items[last.items.length - 1] += " " + stripInlineMarkdown(raw.trim());
    } else {
      para.push(raw.trim());
    }
  }
  flush();
  return blocks;
}
