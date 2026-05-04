/**
 * Brand-colored platform icons for connection rows.
 * Inline SVG so we don't need network requests or external assets.
 */

import { Linkedin, Twitter, Globe, Facebook, Instagram } from "lucide-react";

const PLATFORM_BG: Record<string, string> = {
  LINKEDIN: "bg-[#0A66C2] text-white",
  TWITTER: "bg-black text-white",
  GOOGLE_BUSINESS: "bg-white text-[#4285F4] border border-gray-200",
  FACEBOOK: "bg-[#1877F2] text-white",
  INSTAGRAM: "bg-gradient-to-br from-[#F58529] via-[#DD2A7B] to-[#8134AF] text-white",
};

export function PlatformIcon({
  platform,
  size = 24,
  className = "",
}: {
  platform: string;
  size?: number;
  className?: string;
}) {
  const wrapper = `inline-flex items-center justify-center rounded-lg ${PLATFORM_BG[platform] ?? "bg-gray-100 text-gray-600 border border-gray-200"} ${className}`;
  const dim = { width: size, height: size };
  const iconSize = Math.round(size * 0.55);

  let icon: React.ReactNode = null;
  switch (platform) {
    case "LINKEDIN":
      icon = <Linkedin size={iconSize} fill="currentColor" />;
      break;
    case "TWITTER":
      icon = (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width={iconSize}
          height={iconSize}
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      );
      break;
    case "GOOGLE_BUSINESS":
      icon = (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 48 48"
          width={iconSize}
          height={iconSize}
          aria-hidden="true"
        >
          <path fill="#4285F4" d="M44.5 20H24v8.5h11.7C34.7 33 30 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.7 1.1 7.8 2.9l6.4-6.4C34.5 5.1 29.6 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21c10.5 0 20-7.7 20-21 0-1.4-.2-2.7-.5-4z" />
          <path fill="#34A853" d="M6.3 14.7l7 5.1C15.2 16.1 19.2 13 24 13c3 0 5.7 1.1 7.8 2.9l6.4-6.4C34.5 5.1 29.6 3 24 3 16.3 3 9.7 7.6 6.3 14.7z" />
          <path fill="#FBBC04" d="M24 45c5.4 0 10.3-1.8 14.1-4.9l-6.5-5.5c-2 1.4-4.6 2.4-7.6 2.4-5.9 0-10.9-3.9-12.7-9.3l-7 5.4C7.8 40 15.3 45 24 45z" />
          <path fill="#EA4335" d="M44.5 20H24v8.5h11.7c-.6 2.3-2 4.3-3.9 5.6l6.5 5.5C42.8 36.3 45 30.6 45 24c0-1.4-.2-2.7-.5-4z" />
        </svg>
      );
      break;
    case "FACEBOOK":
      icon = <Facebook size={iconSize} fill="currentColor" />;
      break;
    case "INSTAGRAM":
      icon = <Instagram size={iconSize} />;
      break;
    default:
      icon = <Globe size={iconSize} />;
  }

  return (
    <span style={dim} className={wrapper} aria-label={platform}>
      {icon}
    </span>
  );
}
