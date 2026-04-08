/**
 * Root layout for JobHound Next.js app.
 * Wraps all pages with SessionProvider (next-auth) and global styles.
 * Dark theme is the default via the class on <html>.
 */

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "JobHound — AI-Powered Job Tracker",
  description:
    "Track your job applications with AI-powered parsing, RAG chat, and rich analytics.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
