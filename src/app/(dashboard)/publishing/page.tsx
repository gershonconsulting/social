// X publishing — content library (v4.37.0). Client-side; see page-client.
import { PublishingContentClient } from "./page-client";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default function PublishingPage() {
  return <PublishingContentClient />;
}
