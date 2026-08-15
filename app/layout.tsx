import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "ERRANTE: O Dorso do Mundo",
  description: "Uma vertical slice 3D de sobrevivência sobre um colosso migratório.",
  openGraph: {
    title: "ERRANTE: O Dorso do Mundo",
    description: "Sobreviva sobre o dorso vivo de um colosso que cruza um mundo inundado.",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "ERRANTE — sobrevivente sobre um colosso migratório" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ERRANTE: O Dorso do Mundo",
    description: "Sobreviva sobre o dorso vivo de um colosso que cruza um mundo inundado.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
