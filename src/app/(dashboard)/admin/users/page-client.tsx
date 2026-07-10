"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { UserPlus, Loader2, Trash2, ShieldCheck, Download, Linkedin, Mail } from "lucide-react";

type Role = "ADMIN" | "OPERATIONS" | "READ_ONLY";
interface AppUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  linkedinLinked?: boolean;
  createdAt: string;
}

const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Admin",
  OPERATIONS: "Operations",
  READ_ONLY: "Read only",
};

export default function UsersAdminClient() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // invite form
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("OPERATIONS");
  const [inviting, setInviting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/users", { cache: "no-store" });
      const j = await r.json();
      if (j?.success) setUsers(j.data);
      else setMsg({ kind: "err", text: j?.error || "Failed to load users" });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Network error" });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

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

  async function patch(id: string, data: Partial<Pick<AppUser, "role" | "isActive">>) {
    setMsg(null);
    try {
      const r = await fetch(`/api/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const j = await r.json().catch(() => ({} as { error?: string }));
      if (!r.ok || !j?.success) setMsg({ kind: "err", text: j.error || `HTTP ${r.status}` });
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Network error" });
    }
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

  return (
    <div>
      <Header
        title="Admin — Users"
        subtitle="Invite teammates and control access. Everyone signs in with LinkedIn; email + role is the invite."
      />

      {msg && (
        <div className={"mb-4 text-sm px-3 py-2 rounded-lg " + (msg.kind === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800")}>
          {msg.text}
        </div>
      )}

      {/* Invite */}
      <form onSubmit={invite} className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <UserPlus size={18} className="text-[#FE1B04]" />
          <div className="text-sm font-semibold text-gray-900">Invite a new user</div>
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
          <span className="text-xs text-gray-500">The email must match the one on their LinkedIn account.</span>
        </div>
      </form>

      {/* User list */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 text-sm font-semibold text-gray-900">
          Users {loading ? "" : `(${users.length})`}
        </div>
        {loading ? (
          <div className="p-6 text-center text-sm text-gray-400"><Loader2 size={16} className="animate-spin inline" /> Loading…</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {users.map((u) => (
              <div key={u.id} className="px-4 py-3 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[180px]">
                  <div className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
                    {u.name}
                    {u.linkedinLinked && <Linkedin size={13} className="text-[#0A66C2]" aria-label="LinkedIn linked" />}
                    {u.role === "ADMIN" && <ShieldCheck size={13} className="text-[#FE1B04]" aria-label="Admin" />}
                  </div>
                  <div className="text-xs text-gray-500 font-mono">{u.email}</div>
                </div>
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
                <button onClick={() => remove(u)} className="text-gray-300 hover:text-red-600" title="Remove user">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            {users.length === 0 && <div className="p-6 text-center text-sm text-gray-400">No users yet.</div>}
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
