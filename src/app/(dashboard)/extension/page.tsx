// Thin server shell — everything on this page talks to the Chrome extension
// running in THIS browser, so it is client-side (see page-client).
import { ExtensionPageClient } from "./page-client";
import { EXTENSION_LATEST } from "@/lib/extension-version";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default function ExtensionPage() {
  return <ExtensionPageClient latest={EXTENSION_LATEST} />;
}
