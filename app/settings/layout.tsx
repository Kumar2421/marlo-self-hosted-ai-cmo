import SettingsNav from "@/components/settings/SettingsNav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white text-gray-900 md:flex-row">
      <SettingsNav />
      <div className="min-w-0 flex-1 px-4 py-5 sm:px-6 md:px-10 md:py-8">{children}</div>
    </div>
  );
}
