/**
 * Decides where a social feed folds a long post behind a "see more" link.
 *
 * The fold points are approximations of how the networks fold a post:
 * LinkedIn shows about 210 characters before "see more", and a Reddit text
 * post preview shows about 300. The UI should label any preview built from
 * these numbers as approximate.
 *
 * Pure: no imports, no I/O.
 */
export type Fold = { visible: string; hidden: string; truncated: boolean };

export const LINKEDIN_FOLD_CHARS = 210;
export const REDDIT_BODY_FOLD_CHARS = 300;

/** How far before the limit we look for a word boundary. */
const WORD_BOUNDARY_WINDOW = 25;

function isWhitespace(ch: string | undefined): boolean {
  return ch !== undefined && /\s/.test(ch);
}

export function foldText(text: string, limit: number): Fold {
  const trimmed = text.trim();

  if (limit <= 0) {
    return { visible: "", hidden: trimmed, truncated: trimmed.length > 0 };
  }

  if (trimmed.length <= limit) {
    return { visible: trimmed, hidden: "", truncated: false };
  }

  let cut = limit;
  // Cutting between two non-whitespace characters would split a word, so
  // move the cut back to the nearest whitespace within the window.
  if (!isWhitespace(trimmed[limit]) && !isWhitespace(trimmed[limit - 1])) {
    const floor = Math.max(1, limit - WORD_BOUNDARY_WINDOW);
    for (let j = limit - 1; j >= floor; j--) {
      if (isWhitespace(trimmed[j])) {
        cut = j;
        break;
      }
    }
  }

  return {
    visible: trimmed.slice(0, cut).trimEnd(),
    hidden: trimmed.slice(cut).trimStart(),
    truncated: true,
  };
}

export function linkedinFold(hookLine: string, body: string): Fold {
  const joined = body.trim() === "" ? hookLine : `${hookLine}\n\n${body}`;
  return foldText(joined, LINKEDIN_FOLD_CHARS);
}

export function redditBodyFold(body: string): Fold {
  return foldText(body, REDDIT_BODY_FOLD_CHARS);
}
