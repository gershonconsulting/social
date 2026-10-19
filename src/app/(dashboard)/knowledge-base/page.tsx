// Knowledge Base (v4.51.0) — Value Prop · Competitive Landscape · ICPs per company.
import { Suspense } from "react";
import { KnowledgeBaseClient } from "./page-client";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default function KnowledgeBasePage() {
  return (
    <Suspense>
      <KnowledgeBaseClient />
    </Suspense>
  );
}
