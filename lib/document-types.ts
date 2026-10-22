/** Real config of the 5 strategy documents Marlo's Context panel generates
 * (see refimages). `available: true` means a real generator + route exists.
 * Design Guide / Content Strategy are listed honestly as not-yet-built, not
 * faked as a locked paywall feature. */
export type DocTypeConfig = {
  docType: string;
  name: string;
  available: boolean;
};

export const DOC_TYPES: DocTypeConfig[] = [
  { docType: "product_info", name: "Product Information", available: true },
  { docType: "marketing_strategy", name: "Marketing Strategy", available: true },
  { docType: "competitor_analysis", name: "Competitor Analysis", available: true },
  { docType: "design_guide", name: "Design Guide", available: true },
  { docType: "content_strategy", name: "Content Strategy", available: true },
];

/** Other real, user-facing documents stored in project_documents (not in the Context panel list). */
export const EXTRA_DOCUMENT_TYPES = ["competitor_comparison", "lead_profile"] as const;

/**
 * Allowlist of real document doc_types. The dashboard reads project_documents
 * through this list, so cron marker and settings rows (which share the table)
 * can never crowd real documents out of a row limit. New marker types are
 * excluded by default; a new real document type must be added here.
 */
export const REAL_DOCUMENT_TYPES: readonly string[] = [...DOC_TYPES.map((d) => d.docType), ...EXTRA_DOCUMENT_TYPES];
