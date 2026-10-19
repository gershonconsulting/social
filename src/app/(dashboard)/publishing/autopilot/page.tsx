// Publishing Autopilot (v4.51.0) — see components/publishing/autopilot-panel.
import { Header } from "@/components/layout/header";
import { AutopilotPage } from "@/components/publishing/autopilot-panel";

export const runtime = "edge";

export default function Page() {
  return (
    <div>
      <Header title="Autopilot" eyebrow="Publishing" subtitle="One post a day for Gershon's own companies — written, illustrated and scheduled by AI, approved by you in one batch a month." />
      <AutopilotPage />
    </div>
  );
}
