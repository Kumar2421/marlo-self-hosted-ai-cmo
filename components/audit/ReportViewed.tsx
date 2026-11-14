"use client";

import { useEffect } from "react";
import { trackAuditEvent } from "./trackAuditEvent";

/** Counts one view of a shared report, so the funnel can show how far links travel. */
export default function ReportViewed() {
  useEffect(() => {
    trackAuditEvent({ event: "report_viewed" });
  }, []);
  return null;
}
