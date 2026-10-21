import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FEATURES } from "@/lib/features";
import { isUiGalleryEnabled } from "./guard";
import UiGallery from "./UiGallery";

// Never statically exported or cached: the guard must run on every request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "UI gallery",
  robots: { index: false, follow: false },
};

export default function UiGalleryPage() {
  if (!isUiGalleryEnabled({ nodeEnv: process.env.NODE_ENV, platformMode: FEATURES.PLATFORM_MODE })) notFound();
  return <UiGallery />;
}
