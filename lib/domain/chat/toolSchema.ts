/**
 * Tiny dependency-free argument validator for chat tools (zod is not a dependency).
 * The model's tool arguments are untrusted input: unknown keys are dropped, enums are enforced,
 * strings are bounded, ids must match a known format, numbers are clamped.
 */
export type FieldSpec =
  | { kind: "enum"; values: readonly string[]; required?: boolean }
  | { kind: "id"; test: (v: string) => boolean; required?: boolean }
  | { kind: "string"; max: number; required?: boolean }
  | { kind: "int"; min: number; max: number; default: number };

export type ArgSchema = Record<string, FieldSpec>;
export type ValidateResult = { ok: true; value: Record<string, unknown> } | { ok: false; error: string };

/** Characters that never belong in an enum value or an id. Checked before format tests. */
const MAX_ID_LEN = 80;

export function validateArgs(schema: ArgSchema, input: unknown): ValidateResult {
  // Non-object input (null, array, string) is coerced to "no arguments".
  const raw = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(schema)) {
    const v = Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : undefined;
    const missing = v === undefined || v === null || v === "";
    switch (spec.kind) {
      case "enum": {
        if (missing) { if (spec.required) return { ok: false, error: `${key} is required.` }; break; }
        if (typeof v !== "string" || !spec.values.includes(v)) return { ok: false, error: `${key} must be one of: ${spec.values.join(", ")}.` };
        out[key] = v;
        break;
      }
      case "id": {
        if (missing) { if (spec.required) return { ok: false, error: `${key} is required.` }; break; }
        if (typeof v !== "string" || v.length > MAX_ID_LEN || !spec.test(v)) return { ok: false, error: `${key} is not a valid id. Use an id returned by a list tool.` };
        out[key] = v;
        break;
      }
      case "string": {
        if (missing) { if (spec.required) return { ok: false, error: `${key} is required.` }; break; }
        if (typeof v !== "string") return { ok: false, error: `${key} must be text.` };
        out[key] = v.slice(0, spec.max);
        break;
      }
      case "int": {
        const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
        out[key] = Number.isFinite(n) ? Math.min(spec.max, Math.max(spec.min, Math.trunc(n))) : spec.default;
        break;
      }
    }
  }
  return { ok: true, value: out };
}

/** Finding ids: a UUID (hosted) optionally prefixed "finding_" (self-host). */
const FINDING_ID = /^(finding_)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isFindingId = (v: unknown): v is string => typeof v === "string" && FINDING_ID.test(v);
