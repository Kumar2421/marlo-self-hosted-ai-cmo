export type LogLine =
  | { type: "muted-link"; text: string; at?: number }
  | { type: "divider"; text: string; at?: number }
  | { type: "cmd"; text: string; at?: number }
  | { type: "done"; text: string; at?: number }
  | { type: "error"; text: string; at?: number };
