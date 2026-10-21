export const runtime = "edge";
/**
 * GET /api/publishing/oauth/:net/callback — LinkedIn / X send the account owner
 * back here after "Allow" (v4.60.0). The code is exchanged for the posting
 * permission, which is stored sealed on the company (lib/linked-accounts).
 */
import { NextRequest, NextResponse } from "next/server";
import { SITE, getTarget, saveTarget } from "@/lib/publishing";
import { getLinked, linkedinConnect, liAuthorUrl, saveLinked, takeState, xConnect } from "@/lib/linked-accounts";

const done = (q: string) => NextResponse.redirect(`${SITE}/settings?${q}#linked`);

export async function GET(req: NextRequest, ctx: { params: Promise<{ net: string }> }) {
  const { net } = await ctx.params;
  const sp = new URL(req.url).searchParams;
  const st = await takeState(sp.get("state") || "");
  if (!st || st.net !== net) return done(`linked_error=${encodeURIComponent("This connection link expired — press Connect again.")}`);
  if (sp.get("error")) return done(`linked_error=${encodeURIComponent(`${net === "x" ? "X" : "LinkedIn"}: ${sp.get("error_description") || sp.get("error")}`)}`);
  const code = sp.get("code");
  if (!code) return done(`linked_error=${encodeURIComponent("No authorization came back — press Connect again.")}`);
  try {
    const l = await getLinked(st.orgId, st.clientId);
    const t = await getTarget(st.orgId, st.clientId);
    if (net === "linkedin") {
      l.linkedin = await linkedinConnect(code, st.by, l.linkedin);
      const a = l.linkedin.authors.find((x) => x.urn === l.linkedin!.author);
      const url = liAuthorUrl(a);
      if (url && !t.linkedinUrl) await saveTarget(st.orgId, st.clientId, { linkedinUrl: url });
    } else {
      l.x = await xConnect(code, st.verifier || "", st.by);
      if (!t.xHandle) await saveTarget(st.orgId, st.clientId, { xHandle: l.x.username });
    }
    await saveLinked(st.orgId, st.clientId, l);
    return done(`linked=${net}&company=${encodeURIComponent(st.clientId)}`);
  } catch (e) {
    return done(`linked_error=${encodeURIComponent(e instanceof Error ? e.message : "Connection failed")}`);
  }
}
