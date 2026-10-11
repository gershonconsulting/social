// X publishing — calendar + publishing check (v4.37.0). Client-side; see page-client.
import { PublishingCalendarClient } from "./page-client";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default function PublishingCalendarPage() {
  return <PublishingCalendarClient />;
}
