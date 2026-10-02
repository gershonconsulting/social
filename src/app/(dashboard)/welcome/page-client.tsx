"use client";

/**
 * Getting started.
 *
 * A new workspace is genuinely empty, and the dashboard in that state is a page
 * of zeroes that tells somebody nothing about what to do. This is the page that
 * does.
 *
 * Two decisions shape it.
 *
 * It DOES the work rather than pointing at it. Every step here is a control,
 * not a link to somewhere else with instructions attached — the workspace name
 * is a field, adding a company is a form that creates the company and both its
 * platform links in one call, the token is right there with a copy button. The
 * people arriving here are not engineers, and "go to Companies, click New, fill
 * in eleven fields" is where setup goes to die.
 *
 * Progress is DERIVED, never stored. Each step asks the server whether the
 * thing it wants actually exists (see /api/onboarding). So the list cannot get
 * out of step with reality: add a company from the Companies page and this
 * ticks, delete it again and this un-ticks, and somebody who did half of it last
 * week sees exactly the half that is left.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Check,
  Loader2,
  Copy,
  Download,
  ArrowRight,
  Building2,
  Users,
  Puzzle,
  Sparkles,
  Pencil,
} from "lucide-react";

type Steps = {
  nameWorkspace: boolean;
  addYourCompany: boolean;
  addCompaniesToWatch: boolean;
  installExtension: boolean;
  firstCollection: boolean;
};

type Status = {
  workspace: { id: string; name: string; slug: string; isPrimary: boolean } | null;
  steps: Steps;
  next: string;
  complete: boolean;
  dismissed: boolean;
  counts: { companies: number; linkedinLinks: number; xLinks: number; posts: number };
  ownCompany: { id: string; name: string } | null;
  extensionToken: string;
  extensionLastSeen: string | null;
};

const CATEGORIES = [
  { value: "CLIENT", label: "Client" },
  { value: "PROSPECT", label: "Prospect" },
  { value: "PARTNER", label: "Partner" },
  { value: "COMPETITION", label: "Competitor" },
] as const;

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "company"
  );
}

/** One row of the checklist. Open when it's the step in hand. */
function StepCard({
  n,
  done,
  open,
  icon,
  title,
  why,
  onToggle,
  children,
}: {
  n: number;
  done: boolean;
  open: boolean;
  icon: React.ReactNode;
  title: string;
  why: string;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={
        "rounded-xl border bg-white transition-colors " +
        (open ? "border-[#FE1B04]/40 shadow-sm" : "border-gray-200")
      }
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-start gap-3 text-left p-4"
      >
        <span
          className={
            "mt-0.5 h-6 w-6 shrink-0 rounded-full grid place-items-center text-[11px] font-bold " +
            (done ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")
          }
        >
          {done ? <Check size={14} /> : n}
        </span>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            {icon}
            {title}
          </span>
          <span className="block text-xs text-gray-500 mt-0.5 leading-relaxed">{why}</span>
        </span>
      </button>
      {open && <div className="px-4 pb-4 pl-[52px]">{children}</div>}
    </div>
  );
}

export function WelcomePageClient() {
  const [st, setSt] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // step 1
  const [wsName, setWsName] = useState("");
  // steps 2 + 3
  const [coName, setCoName] = useState("");
  const [coLinkedIn, setCoLinkedIn] = useState("");
  const [coX, setCoX] = useState("");
  const [coType, setCoType] = useState<string>("CLIENT");
  const [added, setAdded] = useState<string[]>([]);

  const load = useCallback(
    async (follow = true) => {
      try {
        const r = await fetch("/api/onboarding");
        const j = await r.json();
        if (!j?.success) throw new Error(j?.error || "Couldn't load your setup status");
        const data = j.data as Status;
        setSt(data);
        setWsName((prev) => prev || data.workspace?.name || "");
        if (follow) setOpen(data.next === "done" ? null : data.next);
        setErr(null);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Couldn't load your setup status");
      }
    },
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Steps 4 and 5 complete somewhere else entirely — in Chrome, and then in
  // whatever LinkedIn hands back. Poll while either is outstanding so the tick
  // appears without the user wondering whether to refresh.
  useEffect(() => {
    if (!st || st.complete) return;
    if (st.next !== "install-extension" && st.next !== "first-collection") return;
    const t = setInterval(() => void load(false), 15000);
    return () => clearInterval(t);
  }, [st, load]);

  const rename = async () => {
    if (!wsName.trim()) return;
    setBusy(true);
    try {
      await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename", name: wsName.trim() }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const addCompany = async (internal: boolean) => {
    const name = coName.trim();
    if (!name) return;
    setBusy(true);
    setErr(null);
    try {
      const platformConnections: Array<{ platform: string; externalAccountUrl: string }> = [];
      if (coLinkedIn.trim()) {
        platformConnections.push({ platform: "LINKEDIN", externalAccountUrl: coLinkedIn.trim() });
      }
      if (coX.trim()) {
        platformConnections.push({ platform: "TWITTER", externalAccountUrl: coX.trim() });
      }
      const r = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          slug: slugify(name),
          clientType: internal ? "INTERNAL" : coType,
          platformConnections,
        }),
      });
      const j = await r.json();
      if (!j?.success) throw new Error(j?.error || "Couldn't add that company");
      setAdded((a) => [name, ...a]);
      setCoName("");
      setCoLinkedIn("");
      setCoX("");
      await load(internal);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't add that company");
    } finally {
      setBusy(false);
    }
  };

  const copyToken = async () => {
    if (!st) return;
    try {
      await navigator.clipboard.writeText(st.extensionToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the value is on screen to select */
    }
  };

  const dismiss = async () => {
    setBusy(true);
    try {
      await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss" }),
      });
      await load(false);
    } finally {
      setBusy(false);
    }
  };

  if (!st) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Loader2 size={16} className="animate-spin" />
        Loading your setup…
      </div>
    );
  }

  const s = st.steps;
  const doneCount = Object.values(s).filter(Boolean).length;
  const field =
    "w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-[#FE1B04]";
  const primaryBtn =
    "inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#FE1B04] text-white text-sm font-semibold hover:bg-[#d11200] disabled:opacity-50";

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          {st.complete ? "You're set up" : "Getting started"}
        </h1>
        <p className="text-sm text-gray-500 mt-1 leading-relaxed">
          {st.complete
            ? "Everything's connected and posts are coming in. This page stays here if you ever need it."
            : "Five things, and your workspace starts collecting. Nothing here needs a developer."}
        </p>
        <div className="flex items-center gap-3 mt-4">
          <div className="h-1.5 flex-1 rounded-full bg-gray-200 overflow-hidden">
            <div
              className="h-full bg-[#FE1B04] transition-all duration-500"
              style={{ width: `${(doneCount / 5) * 100}%` }}
            />
          </div>
          <span className="text-xs font-semibold text-gray-500 tabular-nums">{doneCount} of 5</span>
        </div>
      </div>

      {err && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {err}
        </div>
      )}

      <div className="space-y-3">
        <StepCard
          n={1}
          done={s.nameWorkspace}
          open={open === "name-workspace"}
          onToggle={() => setOpen(open === "name-workspace" ? null : "name-workspace")}
          icon={<Pencil size={14} className="text-[#FE1B04]" />}
          title="Name your workspace"
          why={
            st.workspace
              ? `Currently "${st.workspace.name}". This is what reports and share links are headed.`
              : "What reports and share links are headed."
          }
        >
          <div className="flex flex-wrap gap-2">
            <input
              className={field + " max-w-xs"}
              value={wsName}
              onChange={(e) => setWsName(e.target.value)}
              placeholder="Acme Industries"
            />
            <button type="button" className={primaryBtn} disabled={busy} onClick={rename}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : null}
              Save
            </button>
          </div>
        </StepCard>

        <StepCard
          n={2}
          done={s.addYourCompany}
          open={open === "add-your-company"}
          onToggle={() => setOpen(open === "add-your-company" ? null : "add-your-company")}
          icon={<Building2 size={14} className="text-[#FE1B04]" />}
          title="Add your own company"
          why={
            st.ownCompany
              ? `${st.ownCompany.name} — your own posting is what everything else is measured against.`
              : "Your own posting is what everything else gets measured against."
          }
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className={field + " sm:col-span-2"}
              value={coName}
              onChange={(e) => setCoName(e.target.value)}
              placeholder="Your company name"
            />
            <input
              className={field}
              value={coLinkedIn}
              onChange={(e) => setCoLinkedIn(e.target.value)}
              placeholder="https://www.linkedin.com/company/…"
            />
            <input
              className={field}
              value={coX}
              onChange={(e) => setCoX(e.target.value)}
              placeholder="https://x.com/yourhandle"
            />
          </div>
          <p className="text-xs text-gray-500 mt-2 leading-relaxed">
            Paste the page addresses as they appear in your browser. Either one on its own is fine —
            you can add the other later.
          </p>
          <button
            type="button"
            className={primaryBtn + " mt-3"}
            disabled={busy || !coName.trim()}
            onClick={() => addCompany(true)}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            Add my company
          </button>
        </StepCard>

        <StepCard
          n={3}
          done={s.addCompaniesToWatch}
          open={open === "add-companies-to-watch"}
          onToggle={() =>
            setOpen(open === "add-companies-to-watch" ? null : "add-companies-to-watch")
          }
          icon={<Users size={14} className="text-[#FE1B04]" />}
          title="Add the companies you want to watch"
          why={`Clients, prospects, partners, competitors. ${st.counts.companies} in this workspace so far.`}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className={field}
              value={coName}
              onChange={(e) => setCoName(e.target.value)}
              placeholder="Company name"
            />
            <select className={field} value={coType} onChange={(e) => setCoType(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              className={field}
              value={coLinkedIn}
              onChange={(e) => setCoLinkedIn(e.target.value)}
              placeholder="https://www.linkedin.com/company/…"
            />
            <input
              className={field}
              value={coX}
              onChange={(e) => setCoX(e.target.value)}
              placeholder="https://x.com/handle"
            />
          </div>
          <button
            type="button"
            className={primaryBtn + " mt-3"}
            disabled={busy || !coName.trim()}
            onClick={() => addCompany(false)}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            Add company
          </button>
          {added.length > 0 && (
            <p className="text-xs text-green-700 mt-3">Added: {added.join(", ")}</p>
          )}
          <p className="text-xs text-gray-500 mt-3 leading-relaxed">
            Add as many as you like — the form clears itself each time.{" "}
            <Link href="/clients" className="text-[#FE1B04] font-medium">
              Companies page
            </Link>{" "}
            has the full editor once you&apos;re past setup.
          </p>
        </StepCard>

        <StepCard
          n={4}
          done={s.installExtension}
          open={open === "install-extension"}
          onToggle={() => setOpen(open === "install-extension" ? null : "install-extension")}
          icon={<Puzzle size={14} className="text-[#FE1B04]" />}
          title="Install the Chrome extension"
          why={
            s.installExtension
              ? "Checked in — this workspace is paired with a browser."
              : "It collects from inside your own browser, so LinkedIn and X see a real person."
          }
        >
          <ol className="text-sm text-gray-700 space-y-2 list-decimal pl-4 leading-relaxed">
            <li>
              <a
                href="/gershonai-extension.zip"
                className="inline-flex items-center gap-1.5 text-[#FE1B04] font-medium"
              >
                <Download size={13} /> Download the extension
              </a>{" "}
              and unzip it.
            </li>
            <li>
              Open <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">chrome://extensions</code>,
              turn on <strong>Developer mode</strong>, click <strong>Load unpacked</strong> and pick
              the unzipped folder.
            </li>
            <li>Click the GershonAI icon in the toolbar and paste this token:</li>
          </ol>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <code className="text-xs font-mono bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-800 break-all">
              {st.extensionToken}
            </code>
            <button
              type="button"
              onClick={copyToken}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 border border-gray-200 px-2.5 py-1.5 rounded-lg hover:bg-gray-50"
            >
              {copied ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2 leading-relaxed">
            The token is what tells the extension which workspace to feed. Treat it like a password.
            {st.extensionLastSeen
              ? ` Last check-in: ${new Date(st.extensionLastSeen).toLocaleString()}.`
              : " This step ticks itself the moment the extension calls in."}
          </p>
        </StepCard>

        <StepCard
          n={5}
          done={s.firstCollection}
          open={open === "first-collection"}
          onToggle={() => setOpen(open === "first-collection" ? null : "first-collection")}
          icon={<Sparkles size={14} className="text-[#FE1B04]" />}
          title="Collect for the first time"
          why={
            s.firstCollection
              ? `${st.counts.posts} posts collected. It runs itself once a day from here on.`
              : "One click in the extension, then it runs itself once a day."
          }
        >
          <p className="text-sm text-gray-700 leading-relaxed">
            Make sure you&apos;re signed in to LinkedIn and X in this browser, then open the
            GershonAI icon and press <strong>Sync Now</strong>. It opens a few tabs, reads the pages
            and closes them again — give it a couple of minutes.
          </p>
          <p className="text-xs text-gray-500 mt-2">
            This page is watching; the tick appears on its own when the first posts land.
          </p>
        </StepCard>
      </div>

      <div className="flex flex-wrap items-center gap-3 mt-7">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700 border border-gray-200 bg-white px-4 py-2 rounded-lg hover:bg-gray-50"
        >
          Go to the dashboard <ArrowRight size={14} />
        </Link>
        {!st.dismissed && (
          <button
            type="button"
            onClick={dismiss}
            disabled={busy}
            className="text-xs text-gray-500 hover:text-gray-800 underline disabled:opacity-50"
          >
            Don&apos;t show this automatically any more
          </button>
        )}
      </div>
    </div>
  );
}
