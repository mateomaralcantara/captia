import type { Metadata } from "next";
import { getLang } from "@/lib/server";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CAPTIA Control", template: "%s · CAPTIA Control" },
  description: "Panel de operaciones de CAPTIA OS",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { lang } = await getLang();
  return (
    <html lang={lang}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
