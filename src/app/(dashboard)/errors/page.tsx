import { ErrorsPageClient } from "./page-client";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default function ErrorsPage() {
  return <ErrorsPageClient />;
}
