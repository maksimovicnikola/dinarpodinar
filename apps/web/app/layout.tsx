import type { Metadata } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Mono, IBM_Plex_Sans, Source_Serif_4 } from "next/font/google";

import { Ruler } from "@/components/passbook";

import "./globals.css";

export const metadata: Metadata = {
  title: "Dinar po dinar",
};

// `latin-ext` nosi č, ć, š, ž i đ.
const serif = Source_Serif_4({
  subsets: ["latin-ext"],
  display: "swap",
  variable: "--font-serif",
});

const sans = IBM_Plex_Sans({
  subsets: ["latin-ext"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-sans",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin-ext"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-mono",
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="sr" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <div className="shell">
          <header className="masthead">
            <div className="masthead__inner">
              <p className="wordmark">Dinar po dinar</p>
              <Ruler />
            </div>
          </header>
          <main className="shell__main">{children}</main>
          <footer className="shell__foot">
            <p>Porodična štedna knjižica</p>
          </footer>
        </div>
      </body>
    </html>
  );
}
