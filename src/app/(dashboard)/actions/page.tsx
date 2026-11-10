// Thin server shell — the cards change as the user marks them done or drafts them (see page-client).
import { ActionsPageClient } from "./page-client";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default function ActionsPage() {
  return <ActionsPageClient />;
}
