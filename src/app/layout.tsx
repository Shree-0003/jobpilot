import type { Metadata } from "next";
import "./globals.css";

// Nonce-based CSP requires every page to be rendered per request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "JobPilot — secure job application assistant",
  description: "Human-controlled AI job search and application tracking",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
