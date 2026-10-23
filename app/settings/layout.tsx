import SettingsNav from "@/components/settings/SettingsNav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-ui-text md:flex-row">
      <SettingsNav />
      <div className="min-w-0 flex-1 px-4 py-6 sm:px-6 md:px-10 md:py-9">{children}</div>
    </div>
  );
}
