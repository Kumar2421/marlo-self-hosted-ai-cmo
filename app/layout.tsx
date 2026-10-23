import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import ToastProvider from "@/components/dashboard/Toast";
import QueryProvider from "@/lib/query/QueryProvider";
import ProvidersProvider from "@/lib/providers-store";
import TerminalLogProvider from "@/lib/terminal-log-store";
import ProjectProvider from "@/lib/project-store";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Marlo",
  description: "Open-source, self-hostable AI CMO.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${dmSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <head>
        {/* Sets data-theme before first paint so there is no flash of the wrong theme. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col font-sans">
        <QueryProvider>
        <ToastProvider>
          <ProvidersProvider>
            <TerminalLogProvider>
              <ProjectProvider>{children}</ProjectProvider>
            </TerminalLogProvider>
          </ProvidersProvider>
        </ToastProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
