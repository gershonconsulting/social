"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { OwnWorkspacePanel } from "@/components/admin/own-workspace-panel";
import {
  UserPlus, Loader2, Trash2, ShieldCheck, Download, Linkedin, Mail, KeyRound,
  Check, X, Globe, Clock, LogIn, BadgeCheck, ChevronDown, ChevronRight, UserCheck, Building2,
} from "lucide-react";

type Role = "ADMIN" | "OPERATIONS" | "READ_ONLY";
type RegistrationMode = "approval" | "open";

interface AppUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  linkedinLinked?: boolean;
  hasPassword?: boolean;
  image?: string | null;
  createdAt: string;

  pendingApproval?: boolean;
  approvedAt?: string | null;
  givenName?: string | null;
  familyName?: string | null;
  locale?: string | null;
  emailVerified?: boolean;
  signupSource?: string | null;
  signupIp?: string | null;
  signupCountry?: string | null;
  signupUserAgent?: string | null;
  lastLoginAt?: string | null;
  lastLoginIp?: string | null;
  loginCount?: number;
}

const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Admin",
  OPERATIONS: "Operations",
  READ_ONLY: "Read only",
};

const SOURCE_LABEL: Record<string, string> = {
  "linkedin-self": "Signed up with LinkedIn",
  "linkedin-claim": "LinkedIn (admin claim)",
  invite: "Invited by an admin",
  seed: "Seeded account",
};

function when(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function flag(cc?: string | null): string {
  if (!cc || cc.length !== 2) return "";
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)));
}

export default function UsersAdminClient() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [mode, setMode] = useState<RegistrationMode | null>(null);
  const [savingMode, setSavingMode] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [workspaceFor, setWorkspaceFor] = useState<string | null>(null);

  // invite form
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("OPERATIONS");
  const [inviting, setInviting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [ur, mr] = await Promise.all([
        fetch("/api/users", { cache: "no-store" }),
        fetch("/api/settings/registration", { cache: "no-store" }),
      ]);
      const uj = await ur.json();
      if (uj?.success) setUsers(uj.data);
      else setMsg({ kind: "err", text: uj?.error || "Failed to load users" });
      const mj = await mr.json().catch(() => null);
      if (mj?.success) setMode(mj.data.mode as RegistrationMode);
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Network error" });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function saveMode(next: RegistrationMode) {
    setSavingMode(true);
    setMsg(null);
    try {
      const r = await fetch("/api/settings/registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
      const j = await r.json().catch(() => ({} as { error?: string }));
      if (!r.ok || !j?.success) setMsg({ kind: "err", text: j.error || `HTTP ${r.status}` });
      else {
        setMode(next);
        setMsg({
          kind: "ok",
          text: next === "open"
            ? "New LinkedIn sign-ups now get in immediately, at Read only."
            : "New LinkedIn sign-ups now wait for your approval.",
        });
      }
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Network error" });
    } finally {
      setSavingMode(false);
    }
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!name.trim() || !email.trim()) {
      setMsg({ kind: "err", text: "Name and email are required." });
      return;
    }
    setInviting(true);
    try {
      const r = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim().toLowerCase(), role }),
      });
      const j = await r.json().catch(() => ({} as { error?: string }));
      if (!r.ok || !j?.success) {
        setMsg({ kind: "err", text: j.error || `HTTP ${r.status}` });
      } else {
        setMsg({ kind: "ok", text: `Invited ${email}. They sign in with "Continue with LinkedIn".` });
        setName(""); setEmail(""); setRole("OPERATIONS");
        await load();
      }
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Network error" });
    } finally {
      setInviting(false);
    }
  }

  async function patch(id: string, data: Record<string, unknown>, okText?: string) {
    setMsg(null);
    try {
      const r = await fetch(`/api/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const j = await r.json().catch(() => ({} as { error?: string }));
      if (!r.ok || !j?.success) setMsg({ kind: "err", text: j.error || `HTTP ${r.status}` });
      else if (okText) setMsg({ kind: "ok", text: okText });
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Network error" });
    }
  }

  async function removePassword(u: AppUser) {
    if (!confirm(`Remove the password on ${u.email}?\n\nThey will sign in with LinkedIn only from then on.`)) return;
    await patch(u.id, { removePassword: true }, `${u.email} is now LinkedIn-only.`);
  }

  async function remove(u: AppUser) {
    if (!confirm(`Remove ${u.email}? They will lose access immediately.`)) return;
    setMsg(null);
    try {
      const r = await fetch(`/api/users/${u.id}`, { method: "DELETE" });
      const j = await r.json().catch(() => ({} as { error?: string }));
      if (!r.ok || !j?.success) setMsg({ kind: "err", text: j.error || `HTTP ${r.status}` });
      else setMsg({ kind: "ok", text: `Removed ${u.email}.` });
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Network error" });
    }
  }

  const pending = users.filter((u) => u.pendingApproval);
  const active = users.filter((u) => !u.pendingApproval);

  function Detail({ u }: { u: AppUser }) {
    const rows: Array<[string, React.ReactNode]> = [
      ["Full name", [u.givenName, u.familyName].filter(Boolean).join(" ") || u.name || "—"],
      ["Email", <span key="e" className="font-mono">{u.email}{u.emailVerified ? <BadgeCheck size={12} className="inline ml-1 text-green-600" /> : null}</span>],
      ["How they got here", u.signupSource ? SOURCE_LABEL[u.signupSource] ?? u.signupSource : "—"],
      ["First seen", when(u.createdAt)],
      ["Approved", when(u.approvedAt)],
      ["Last sign-in", when(u.lastLoginAt)],
      ["Sign-ins", String(u.loginCount ?? 0)],
      ["Country at sign-up", u.signupCountry ? `${flag(u.signupCountry)} ${u.signupCountry}` : "—"],
      ["IP at sign-up", <span key="i" className="font-mono">{u.signupIp || "—"}</span>],
      ["Last IP", <span key="li" className="font-mono">{u.lastLoginIp || "—"}</span>],
      ["Locale", u.locale || "—"],
      ["LinkedIn linked", u.linkedinLinked ? "Yes" : "No"],
      ["Password set", u.hasPassword ? "Yes" : "No"],
    ];
    return (
      <div className="px-4 pb-4 -mt-1">
        <div className="bg-gray-50 rounded-lg p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline gap-2 text-xs">
              <span className="text-gray-500 shrink-0 min-w-[120px]">{k}</span>
              <span className="text-gray-900 break-all">{v}</span>
            </div>
          ))}
          {u.signupUserAgent && (
            <div className="flex items-baseline gap-2 text-xs sm:col-span-2 lg:col-span-3">
              <span className="text-gray-500 shrink-0 min-w-[120px]">Browser at sign-up</span>
              <span className="text-gray-900 break-all font-mono">{u.signupUserAgent}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  function Row({ u }: { u: AppUser }) {
    const open = !!expanded[u.id];
    return (
      <div>
        <div className="px-4 py-3 flex flex-wrap items-center gap-3">
          <button
            onClick={() => setExpanded((p) => ({ ...p, [u.id]: !p[u.id] }))}
            className="text-gray-400 hover:text-gray-700 shrink-0"
            title={open ? "Hide details" : "Show everything we know"}
          >
            {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>

          {u.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={u.image} alt="" className="w-8 h-8 rounded-full shrink-0 object-cover" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-gray-100 shrink-0 flex items-center justify-center text-xs font-medium text-gray-500">
              {(u.name || u.email).slice(0, 1).toUpperCase()}
            </div>
          )}

          <div className="flex-1 min-w-[180px]">
            <div className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
              {u.name}
              {u.linkedinLinked && <Linkedin size={13} className="text-[#0A66C2]" aria-label="LinkedIn linked" />}
              {u.role === "ADMIN" && <ShieldCheck size={13} className="text-[#FE1B04]" aria-label="Admin" />}
              {u.emailVerified && <BadgeCheck size={13} className="text-green-600" aria-label="Email verified by LinkedIn" />}
            </div>
            <div className="text-xs text-gray-500 font-mono">{u.email}</div>
            <div className="text-[11px] text-gray-400 flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
              {u.signupCountry && <span>{flag(u.signupCountry)} {u.signupCountry}</span>}
              <span className="inline-flex items-center gap-1"><Clock size={10} /> joined {when(u.createdAt)}</span>
              <span className="inline-flex items-center gap-1"><LogIn size={10} /> {u.loginCount ?? 0} sign-ins</span>
              {u.signupSource && <span className="inline-flex items-center gap-1"><Globe size={10} /> {SOURCE_LABEL[u.signupSource] ?? u.signupSource}</span>}
            </div>
          </div>

          {u.pendingApproval ? (
            <>
              <button
                onClick={() => patch(u.id, { approve: true }, `${u.email} approved.`)}
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 font-medium"
              >
                <Check size={13} /> Approve
              </button>
              <button
                onClick={() => patch(u.id, { approve: false }, `${u.email} rejected.`)}
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"
              >
                <X size={13} /> Reject
              </button>
            </>
          ) : (
            <>
              <select
                value={u.role}
                onChange={(e) => patch(u.id, { role: e.target.value as Role })}
                className="text-xs px-2 py-1 border border-gray-300 rounded-lg bg-white"
                title="Role"
              >
                {(["ADMIN", "OPERATIONS", "READ_ONLY"] as Role[]).map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </select>
              <button
                onClick={() => patch(u.id, { isActive: !u.isActive })}
                className={"text-xs px-2.5 py-1 rounded-full font-medium " + (u.isActive ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500")}
                title="Toggle access"
              >
                {u.isActive ? "Active" : "Disabled"}
              </button>
              {u.hasPassword && (
                <button
                  onClick={() => removePassword(u)}
                  disabled={!u.linkedinLinked}
                  className={
                    "inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border " +
                    (u.linkedinLinked
                      ? "border-gray-300 text-gray-600 hover:bg-gray-50"
                      : "border-gray-200 text-gray-300 cursor-not-allowed")
                  }
                  title={
                    u.linkedinLinked
                      ? "Drop the password — this account signs in with LinkedIn only"
                      : "Available once this account has signed in with LinkedIn at least once"
                  }
                >
                  <KeyRound size={12} /> Remove password
                </button>
              )}
              <button
                onClick={() => setWorkspaceFor(workspaceFor === u.id ? null : u.id)}
                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"
                title="Move this person into a workspace of their own, with only the companies you pick"
              >
                <Building2 size={12} /> Own workspace
              </button>
            </>
          )}

          <button onClick={() => remove(u)} className="text-gray-300 hover:text-red-600" title="Remove user">
            <Trash2 size={15} />
          </button>
        </div>
        {open && <Detail u={u} />}
        {workspaceFor === u.id && (
          <OwnWorkspacePanel
            user={u}
            onCancel={() => setWorkspaceFor(null)}
            onDone={async (text) => {
              setWorkspaceFor(null);
              setMsg({ kind: "ok", text });
              await load();
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div>
      <Header
        title="Admin — Users"
        subtitle="Anyone can sign up with LinkedIn. You decide who gets in and what they can see."
      />

      {msg && (
        <div className={"mb-4 text-sm px-3 py-2 rounded-lg " + (msg.kind === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800")}>
          {msg.text}
        </div>
      )}

      {/* Registration mode */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-center gap-2 mb-1">
          <UserCheck size={18} className="text-[#FE1B04]" />
          <div className="text-sm font-semibold text-gray-900">New LinkedIn sign-ups</div>
        </div>
        <div className="text-xs text-gray-500 mb-3">
          Sign-up itself is open to anyone with a LinkedIn account. This decides what happens next.
          New accounts always start at <strong>Read only</strong> — signing up never grants a higher role.
        </div>
        <div className="flex flex-wrap gap-2">
          {([
            ["approval", "Wait for my approval", "They land in the queue below and can't see anything until you approve them."],
            ["open", "Let them in immediately", "They can sign in straight away, at Read only. They will see client data."],
          ] as Array<[RegistrationMode, string, string]>).map(([m, label, help]) => (
            <button
              key={m}
              onClick={() => saveMode(m)}
              disabled={savingMode || mode === m}
              className={
                "text-left px-3 py-2 rounded-lg border text-xs max-w-sm " +
                (mode === m
                  ? "border-[#FE1B04] bg-red-50 text-gray-900"
                  : "border-gray-300 text-gray-600 hover:bg-gray-50")
              }
            >
              <div className="font-medium flex items-center gap-1.5">
                {mode === m && <Check size={12} className="text-[#FE1B04]" />}
                {label}
              </div>
              <div className="text-gray-500 mt-0.5">{help}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Pending approval */}
      {pending.length > 0 && (
        <div className="bg-white rounded-xl border border-amber-300 overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-amber-100 bg-amber-50 text-sm font-semibold text-amber-900">
            Waiting for approval ({pending.length})
          </div>
          <div className="divide-y divide-gray-100">
            {pending.map((u) => <Row key={u.id} u={u} />)}
          </div>
        </div>
      )}

      {/* Invite */}
      <form onSubmit={invite} className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <UserPlus size={18} className="text-[#FE1B04]" />
          <div className="text-sm font-semibold text-gray-900">Invite someone directly</div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <input
            type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name"
            className="w-full text-sm px-3 py-2 border border-gray-300 rounded-lg sm:col-span-1"
          />
          <input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="their LinkedIn email"
            className="w-full text-sm px-3 py-2 border border-gray-300 rounded-lg sm:col-span-2 font-mono"
          />
          <select
            value={role} onChange={(e) => setRole(e.target.value as Role)}
            className="w-full text-sm px-3 py-2 border border-gray-300 rounded-lg bg-white"
          >
            <option value="ADMIN">Admin</option>
            <option value="OPERATIONS">Operations</option>
            <option value="READ_ONLY">Read only</option>
          </select>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button type="submit" disabled={inviting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-[#FE1B04] hover:bg-red-700 rounded-lg disabled:opacity-60">
            {inviting ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
            Send invite
          </button>
          <span className="text-xs text-gray-500">
            An invite skips the queue — they're approved the moment they sign in. The email must match their LinkedIn account.
          </span>
        </div>
      </form>

      {/* User list */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 text-sm font-semibold text-gray-900">
          Users {loading ? "" : `(${active.length})`}
        </div>
        {loading ? (
          <div className="p-6 text-center text-sm text-gray-400"><Loader2 size={16} className="animate-spin inline" /> Loading…</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {active.map((u) => <Row key={u.id} u={u} />)}
            {active.length === 0 && <div className="p-6 text-center text-sm text-gray-400">No users yet.</div>}
          </div>
        )}
      </div>

      {/* Chrome extension — for a new computer */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-start gap-3">
          <Download size={18} className="text-[#FE1B04] mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-gray-900">GershonAI Chrome extension</div>
            <div className="text-xs text-gray-500 mt-0.5 mb-3">
              Each user installs this on their own computer to capture LinkedIn/X sessions for scraping.
              Download the zip, unzip it, then in <code className="bg-gray-100 px-1 rounded">chrome://extensions</code> →
              Developer mode → <strong>Load unpacked</strong> → pick the unzipped folder.
            </div>
            <a href="/gershonai-extension.zip" download
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-[#0A66C2] hover:bg-[#004182] rounded-lg">
              <Download size={14} /> Download extension (.zip)
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
