"use client";
// Last line of defence: an error in the root layout itself. Must render its
// own <html> and <body>.
import "./globals.css";
import { AutoRecover } from "@/components/layout/auto-recover";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased bg-[#F5F4F0]">
        <AutoRecover error={error} />
      </body>
    </html>
  );
}
