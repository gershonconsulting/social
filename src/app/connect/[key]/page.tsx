// A client's publishing-extension connect page (v4.42.0). Public: the
// publishing key in the URL is the access. The extension's content script
// (gx-bridge.js, 0.17.0+) reads the key from this page's address and stores it.
import type { Metadata } from "next";
import { ConnectClient } from "./page-client";

export const runtime = "edge";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connect publishing", robots: { index: false, follow: false } };

export default async function ConnectPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return <ConnectClient keyId={key} />;
}
