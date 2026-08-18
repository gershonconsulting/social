export const runtime = 'edge';

import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { Landing } from "@/components/home/landing";
import { APP_VERSION, EXTENSION_LATEST } from "@/lib/extension-version";

export const metadata: Metadata = {
  title: "social.gershonCRM — Proof that every campaign is actually published",
  description:
    "Social collects what your companies really posted on LinkedIn and X, every day, and turns it into a compliance record and a client-ready monthly report. Collection runs in your own browser through a Chrome extension.",
  openGraph: {
    title: "social.gershonCRM — Social campaign compliance",
    description:
      "Companies → Collection → Proof. Social turns what your clients actually published on LinkedIn and X into a daily compliance picture and a monthly report.",
    type: "website",
    url: "https://social.gershoncrm.com",
  },
};

export default async function RootPage() {
  const session = await getSession().catch(() => null);

  return (
    <Landing
      signedIn={Boolean(session)}
      appVersion={APP_VERSION}
      extensionVersion={EXTENSION_LATEST}
    />
  );
}
