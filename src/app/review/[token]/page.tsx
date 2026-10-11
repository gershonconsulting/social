// The client's review portal (v4.37.0). Public: the private token in the URL
// is the access (see /api/review/[token]). Client-side; see page-client.
import type { Metadata } from "next";
import { ReviewClient } from "./page-client";

export const runtime = "edge";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Content review", robots: { index: false, follow: false } };

export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ReviewClient token={token} />;
}
