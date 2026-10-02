import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Onest } from "next/font/google";

import { Masthead } from "@/components/masthead";

import "./globals.css";

export const metadata: Metadata = {
  title: "Dinar po dinar",
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

// `latin-ext` nosi č, ć, š, ž i đ.
const sans = Onest({
  subsets: ["latin-ext"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-sans",
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="sr" className={sans.variable}>
      <body>
        <div className="shell">
          <Masthead />
          <main className="shell__main">{children}</main>
        </div>
      </body>
    </html>
  );
}
