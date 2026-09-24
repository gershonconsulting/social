"use client";

/**
 * Sign in — v4.9.0 "Charcoal & Signal Red".
 * LinkedIn is the front door; the email/password form stays available,
 * folded away, for accounts that still have a password.
 */

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Check, Download, Loader2 } from "lucide-react";

const POINTS = [
  "Daily collection from LinkedIn and X",
  "Alerts when a company goes silent",
  "Monthly reports you can share with a link",
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [urlError, setUrlError] = useState("");
  const [showEmail, setShowEmail] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const e = p.get("error");
    if (e) setUrlError(e);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("Invalid email or password.");
    } else {
      router.push("/dashboard");
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Brand panel */}
      <section className="hidden lg:flex flex-col justify-between bg-[#111317] text-white px-16 py-14">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-red-600 flex items-center justify-center font-bold text-lg">G</div>
          <div className="text-base font-semibold">
            Gershon.AI <span className="text-[#8E949F] font-normal">Social</span>
          </div>
        </div>
        <div className="max-w-[520px] space-y-5">
          <h1 className="text-[44px] leading-[1.1] font-semibold tracking-tight">
            See what every company you follow is publishing.
          </h1>
          <p className="text-[17px] leading-relaxed text-[#B4B9C2]">
            LinkedIn and X activity for your clients, partners and competitors, collected daily and in one place.
          </p>
          <ul className="space-y-3 pt-2">
            {POINTS.map((p) => (
              <li key={p} className="flex items-center gap-3 text-[15px] text-[#DDE0E5]">
                <Check size={18} className="text-[#FF6B5E]" strokeWidth={2.2} />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <div className="text-[13px] text-[#8E949F]">© {new Date().getFullYear()} Gershon Consulting LLC</div>
      </section>

      {/* Sign-in panel */}
      <section className="bg-[#F5F4F0] flex flex-col items-center justify-center px-4 py-12">
        <div className="lg:hidden flex items-center gap-2.5 mb-8">
          <div className="w-8 h-8 rounded-lg bg-red-600 flex items-center justify-center font-bold text-white">G</div>
          <div className="text-base font-semibold text-gray-900">
            Gershon.AI <span className="text-gray-500 font-normal">Social</span>
          </div>
        </div>

        <div className="w-full max-w-[400px] bg-white border border-gray-200 rounded-2xl p-9 space-y-6">
          <div className="space-y-1.5">
            <h2 className="text-2xl font-semibold tracking-tight text-gray-900">Sign in</h2>
            <p className="text-sm text-gray-600">New here? Signing in creates your own workspace.</p>
          </div>

          {(error || urlError) && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error || urlError}
            </div>
          )}

          <a
            href="/api/auth/linkedin/login"
            className="w-full flex items-center justify-center gap-2.5 h-12 px-4 bg-[#0A66C2] hover:bg-[#004182] text-white text-[15px] font-semibold rounded-lg transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.8 0 0 .77 0 1.73v20.54C0 23.23.8 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z"/></svg>
            Continue with LinkedIn
          </a>

          <p className="text-xs leading-relaxed text-gray-500">
            We use LinkedIn only to confirm who you are. We never post on your behalf.
          </p>

          {!showEmail ? (
            <button
              type="button"
              onClick={() => setShowEmail(true)}
              className="text-sm font-medium text-gray-600 hover:text-gray-900 underline underline-offset-4 decoration-gray-300"
            >
              Sign in with email instead
            </button>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 pt-2 border-t border-gray-100">
              <div className="pt-4">
                <label htmlFor="email" className="block text-[13px] font-medium text-gray-800 mb-1.5">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full h-10 px-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-600/30 focus:border-red-600"
                  placeholder="you@company.com"
                />
              </div>
              <div>
                <label htmlFor="password" className="block text-[13px] font-medium text-gray-800 mb-1.5">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full h-10 px-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-600/30 focus:border-red-600"
                  placeholder="••••••••"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 h-10 px-4 bg-gray-900 hover:bg-black text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {loading ? "Signing in…" : "Sign in"}
              </button>
            </form>
          )}
        </div>

        <a
          href="/gershonai-extension.zip"
          download
          className="mt-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-gray-600 hover:text-gray-900"
        >
          <Download size={14} />
          Download the GershonAI Chrome extension
        </a>
      </section>
    </div>
  );
}
