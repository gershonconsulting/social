export const runtime = 'edge';
import type { Metadata } from "next";
import "./globals.css";
// v4.66.0 unified Gershon design — override layer, must stay the LAST stylesheet import.
import "./unified-theme.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "Social by Gershon.AI",
  applicationName: "Social by Gershon.AI",
  description: "Social by Gershon.AI — collect and understand what your clients, partners, competitors and your own company post on LinkedIn and X",
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
