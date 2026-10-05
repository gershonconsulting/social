"use client";
// Any page under the dashboard that throws shows the self-healing screen
// inside the normal layout, instead of Next's blank "Application error".
//
// v4.30.1 — on a company page (/clients/<id>) the Export menu is shown above
// it as well, so a company whose page crashes can still be downloaded.
import { usePathname } from "next/navigation";
import { AutoRecover } from "@/components/layout/auto-recover";
import { ClientExportMenu } from "@/components/clients/client-export-menu";

export default function DashboardError({ error }: { error: Error & { digest?: string } }) {
  const pathname = usePathname() || "";
  const m = pathname.match(/^\/clients\/([A-Za-z0-9_-]{6,40})\/?$/);
  return (
    <div className="space-y-4">
      {m && (
        <div className="flex justify-end">
          <ClientExportMenu clientId={m[1]} />
        </div>
      )}
      <AutoRecover error={error} />
    </div>
  );
}
