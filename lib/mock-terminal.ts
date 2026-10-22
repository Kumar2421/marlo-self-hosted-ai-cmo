export type LogLine =
  | { type: "muted-link"; text: string }
  | { type: "divider"; text: string }
  | { type: "cmd"; text: string }
  | { type: "done"; text: string }
  | { type: "error"; text: string };
