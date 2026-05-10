"use client";
import { useState, useEffect, useCallback } from "react";
import { ExternalLink, ThumbsUp, MessageCircle, Share2, AlertTriangle, RefreshCw } from "lucide-react";

interface Post {
  id: string;
  platform: string;
  postUrl: string | null;
  postTextSnippet: string | null;
  hasMedia: boolean;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  publishedAtUtc: string;
  publishedDateLocal: string;
}

const PLATFORM_LABELS: Record<string, string> = {
  LINKEDIN: "LinkedIn",
  TWITTER: "X / Twitter",
  GOOGLE_BUSINESS: "Google Business",
};

type LoadState = "loading" | "ok" | "error";

type WindowKey = "WEEK" | "LAST_MONTH" | "THIS_MONTH" | "YEAR" | "ALL_TIME";
const WINDOW_LABELS: Record<WindowKey, string> = {
  WEEK: "Last week",
  LAST_MONTH: "Last month",
  THIS_MONTH: "This month",
  YEAR: "This year",
  ALL_TIME: "All time",
};
const WINDOW_MONTHS: Record<WindowKey, string> = {
  WEEK: "1",
  LAST_MONTH: "2",
  THIS_MONTH: "2",
  YEAR: "12",
  ALL_TIME: "12",
};

export function PostsListing({ clientId, platform }: { clientId: string; platform?: string }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [attempt, setAttempt] = useState(0);
  // Default to "This month" — matches the memory directive on dashboard windows
  const [windowKey, setWindowKey] = useState<WindowKey>("THIS_MONTH");

  const loadPosts = useCallback(async () => {
    setState("loading");
    setErrorMsg("");

    const params = new URLSearchParams({ months: WINDOW_MONTHS[windowKey], calendar: "0" });
    if (platform) params.set("platform", platform);

    // Tiny retry: edge runtime / Neon cold-starts intermittently 500.
    // Try up to 3 times with short backoff before surfacing an error.
    let lastErr = "";
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(`/api/clients/${clientId}/posts?${params}`, {
          cache: "no-store",
        });
        if (!r.ok) {
          let body: unknown = null;
          try {
            body = await r.json();
          } catch {
            // Non-JSON response (e.g. Cloudflare HTML error page)
          }
          const msg =
            (body as { error?: string } | null)?.error ||
            `Posts API returned HTTP ${r.status}`;
          lastErr = msg;
        } else {
          const data = await r.json();
          setPosts(data?.data?.posts ?? []);
          setState("ok");
          return;
        }
      } catch (e) {
        lastErr = e instanceof Error ? e.message : "Network error";
      }
      // Backoff: 250ms, 500ms
      await new Promise((res) => setTimeout(res, 250 * (i + 1)));
    }
    setErrorMsg(lastErr || "Could not load posts.");
    setState("error");
  }, [clientId, platform, windowKey]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts, attempt]);

  if (state === "loading") {
    return (
      <div className="px-6 py-12 text-center text-sm text-gray-400">
        Loading posts…
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="px-6 py-10 flex flex-col items-center text-center gap-3 bg-amber-50 border border-amber-200 rounded-xl mx-6 my-4">
        <AlertTriangle size={20} className="text-amber-600" />
        <div>
          <div className="text-sm font-semibold text-amber-900">
            Could not load posts
          </div>
          <div className="text-xs text-amber-800 mt-1 max-w-md">
            {errorMsg}
          </div>
        </div>
        <button
          onClick={() => setAttempt((a) => a + 1)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-900 bg-white border border-amber-300 rounded-lg hover:bg-amber-100 transition-colors"
        >
          <RefreshCw size={12} />
          Retry
        </button>
      </div>
    );
  }

  // Apply window-specific filtering. The API gives us the broader chunk;
  // we narrow to the user's selected window so KPIs match the label.
  const now = new Date();
  let windowStart: Date | null = null;
  let windowEnd: Date | null = null;
  if (windowKey === "WEEK") {
    windowStart = new Date(now);
    windowStart.setDate(now.getDate() - 7);
  } else if (windowKey === "LAST_MONTH") {
    const firstOfThis = new Date(now.getFullYear(), now.getMonth(), 1);
    windowStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    windowEnd = firstOfThis;
  } else if (windowKey === "THIS_MONTH") {
    windowStart = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (windowKey === "YEAR") {
    windowStart = new Date(now.getFullYear(), 0, 1);
  }
  const visiblePosts = posts.filter((p) => {
    const t = new Date(p.publishedAtUtc).getTime();
    if (windowStart && t < windowStart.getTime()) return false;
    if (windowEnd && t >= windowEnd.getTime()) return false;
    return true;
  });

  const Selector = () => (
    <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex flex-wrap items-center gap-1.5">
      {(Object.keys(WINDOW_LABELS) as WindowKey[]).map((k) => (
        <button
          key={k}
          onClick={() => setWindowKey(k)}
          className={
            "px-2.5 py-1 text-xs rounded-full transition-colors " +
            (windowKey === k
              ? "bg-red-600 text-white"
              : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-100")
          }
        >
          {WINDOW_LABELS[k]}
        </button>
      ))}
      <span className="ml-auto text-xs text-gray-500">
        {visiblePosts.length} post{visiblePosts.length === 1 ? "" : "s"}
      </span>
    </div>
  );

  if (visiblePosts.length === 0) {
    return (
      <>
        <Selector />
        <div className="px-6 py-12 text-center text-sm text-gray-400">
          No posts in this window. Try another range or run a sync.
        </div>
      </>
    );
  }

  return (
    <>
    <Selector />
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-100">
          <tr>
            <th className="text-left px-6 py-3 font-medium text-gray-500 text-xs">Date</th>
            <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs">Platform</th>
            <th className="text-left px-4 py-3 font-medium text-gray-500 text-xs">Post</th>
            <th className="text-center px-4 py-3 font-medium text-gray-500 text-xs">
              <ThumbsUp size={12} className="inline mr-1" />Likes
            </th>
            <th className="text-center px-4 py-3 font-medium text-gray-500 text-xs">
              <MessageCircle size={12} className="inline mr-1" />Comments
            </th>
            <th className="text-center px-4 py-3 font-medium text-gray-500 text-xs">
              <Share2 size={12} className="inline mr-1" />Shares
            </th>
            <th className="text-right px-6 py-3 font-medium text-gray-500 text-xs">Link</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {visiblePosts.map((post) => (
            <tr key={post.id} className="hover:bg-gray-50">
              <td className="px-6 py-3 text-xs font-mono text-gray-600 whitespace-nowrap">
                {post.publishedDateLocal}
              </td>
              <td className="px-4 py-3 text-xs text-gray-500">
                {PLATFORM_LABELS[post.platform] ?? post.platform}
              </td>
              <td className="px-4 py-3 max-w-md">
                <p className="text-sm text-gray-700 line-clamp-2">
                  {post.postTextSnippet || <span className="italic text-gray-400">No text</span>}
                </p>
                {post.hasMedia && (
                  <span className="text-xs text-blue-500 mt-0.5 inline-block">📎 Media</span>
                )}
              </td>
              <td className="px-4 py-3 text-center text-sm font-medium text-gray-700">
                {post.likeCount > 0 ? post.likeCount.toLocaleString() : "—"}
              </td>
              <td className="px-4 py-3 text-center text-sm font-medium text-gray-700">
                {post.commentCount > 0 ? post.commentCount.toLocaleString() : "—"}
              </td>
              <td className="px-4 py-3 text-center text-sm font-medium text-gray-700">
                {post.shareCount > 0 ? post.shareCount.toLocaleString() : "—"}
              </td>
              <td className="px-6 py-3 text-right">
                {post.postUrl ? (
                  <a
                    href={post.postUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                  >
                    <ExternalLink size={12} />
                    View
                  </a>
                ) : (
                  <span className="text-xs text-gray-300">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}
