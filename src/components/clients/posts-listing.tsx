"use client";
import { useState, useEffect } from "react";
import { ExternalLink, ThumbsUp, MessageCircle, Share2 } from "lucide-react";

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
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  YOUTUBE: "YouTube",
};

export function PostsListing({ clientId, platform }: { clientId: string; platform?: string }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams({ months: "2" });
    if (platform) params.set("platform", platform);

    fetch(`/api/clients/${clientId}/posts?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setPosts(data.data?.posts ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [clientId, platform]);

  if (loading) {
    return (
      <div className="px-6 py-12 text-center text-sm text-gray-400">
        Loading posts…
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="px-6 py-12 text-center text-sm text-gray-400">
        No posts found in the last 2 months. Run a sync to fetch posts.
      </div>
    );
  }

  return (
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
          {posts.map((post) => (
            <tr key={post.id} className="hover:bg-gray-50">
              <td className="px-6 py-3 text-xs font-mono text-gray-600 whitespace-nowrap">
                {post.publishedDateLocal}
              </td>
              <td className="px-4 py-3 text-xs text-gray-500">
                {PLATFORM_LABELS[post.platform] ?? post.platform}
              </td>
              <td className="px-4 py-3 max-w-md">
                <p className="text-sm text-gray-700 truncate">
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
  );
}
