export const runtime = 'edge';

import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { Landing } from "@/components/home/landing";
import { APP_VERSION, EXTENSION_LATEST } from "@/lib/extension-version";

export const metadata: Metadata = {
  title: "Social by Gershon.AI — Social network management software for LinkedIn & X",
  description:
    "Social collects every LinkedIn and X post from the companies you are connected with — clients, partners, competitors and your own company — and turns them into analytics, competitor watch and monthly PDF reports.",
  openGraph: {
    title: "Social by Gershon.AI — Social network management software",
    description:
      "See who is posting what across your whole business world — clients, partners, competitors and your own company, on LinkedIn and X.",
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
