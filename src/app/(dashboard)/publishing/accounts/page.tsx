// Publishing → Accounts & review links (v4.37.0). Client-side; see page-client.
import { PublishingAccountsClient } from "./page-client";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default function PublishingAccountsPage() {
  return <PublishingAccountsClient />;
}
