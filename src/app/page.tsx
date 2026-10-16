export const runtime = 'edge';

import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { Landing } from "@/components/home/landing";
import { APP_VERSION, EXTENSION_LATEST } from "@/lib/extension-version";

export const metadata: Metadata = {
  title: "Social by Gershon.AI — Social network management software for LinkedIn & X",
  description:
    "Social is social network management software for LinkedIn and X: plan content, get client approval in one batch, publish on both networks at once, then track what really went live with daily collection, competitor watch, analytics and monthly PDF reports.",
  openGraph: {
    title: "Social by Gershon.AI — Social network management software",
    description:
      "Plan, approve, publish and measure LinkedIn and X for every company you manage — from first draft to monthly proof.",
    type: "website",
    url: "https://social.gershon.ai",
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
