import { CoveragePageClient } from "./page-client";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default function CoveragePage() {
  return <CoveragePageClient />;
}
