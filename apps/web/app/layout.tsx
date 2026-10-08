import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Onest } from "next/font/google";

import { Masthead } from "@/components/masthead";
import { SITE_URL } from "@/lib/site";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: SITE_URL,
  title: {
    default: "Dinar po dinar | Porodične finansije na jednom mestu",
    template: "%s | Dinar po dinar",
  },
  description:
    "Jednostavna evidencija porodičnih prihoda i troškova. Pratite kategorije, mesečne limite i ponavljajuće troškove zajedno sa članovima domaćinstva.",
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    type: "website",
    locale: "sr_RS",
    siteName: "Dinar po dinar",
    title: "Dinar po dinar | Porodične finansije na jednom mestu",
    description:
      "Zajednički pregled porodičnih prihoda, troškova, kategorija i mesečnih limita.",
    url: "/",
  },
  twitter: {
    card: "summary",
    title: "Dinar po dinar | Porodične finansije na jednom mestu",
    description:
      "Zajednički pregled porodičnih prihoda, troškova, kategorija i mesečnih limita.",
  },
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
