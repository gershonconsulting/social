export const runtime = 'edge';
import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "Social by Gershon.AI",
  applicationName: "Social by Gershon.AI",
  description: "Social Media Campaign Compliance & Reporting — Gershon Consulting",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
