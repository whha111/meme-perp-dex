import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "@rainbow-me/rainbowkit/styles.css";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "MemePerpDEX",
  description: "Meme coin spot and perpetual trading platform on Base Chain",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" style={{ background: '#0B0B0B' }}>
      <body className={inter.className} style={{ background: '#0B0B0B', minHeight: '100vh' }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
