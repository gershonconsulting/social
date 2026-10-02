// Thin server shell — the checklist is client-side because every step reads
// back live state as the user completes it (see page-client).
import { WelcomePageClient } from "./page-client";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default function WelcomePage() {
  return <WelcomePageClient />;
}
