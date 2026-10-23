import { redirect } from "next/navigation";

// This page only ever said "not built yet"; the route stays so old links land somewhere real.
export default function RemovedSettingsPage() {
  redirect("/settings/websites");
}
