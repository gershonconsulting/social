/**
 * The Social app icon — Social's official icon (red outline, white ring, red
 * rounded square split light/dark on the diagonal, white "share" glyph),
 * redrawn as a vector. One icon everywhere: browser tab (src/app/icon.svg),
 * Chrome extension (scripts/social-icon.mjs), sidebar, sign-in and home page.
 * Product name: "Social by Gershon.AI", like Radar / Pulse / Company / Finance.
 */
export function SocialMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="social-mark-r" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#E3382B" />
          <stop offset="0.52" stopColor="#D02C20" />
          <stop offset="0.52" stopColor="#BB241A" />
          <stop offset="1" stopColor="#A51D15" />
        </linearGradient>
        <linearGradient id="social-mark-w" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#D5D7D8" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="61" height="61" rx="27" fill="url(#social-mark-w)" stroke="#C8201A" strokeWidth="1.8" />
      <rect x="6.5" y="6.5" width="51" height="51" rx="21" fill="url(#social-mark-r)" />
      <path d="M25.5 32 L39 25 M25.5 32 L39 39" stroke="#EDEDED" strokeWidth="3.8" strokeLinecap="round" />
      <circle cx="25.5" cy="32" r="5" fill="#EDEDED" />
      <circle cx="39" cy="25" r="5.2" fill="#EDEDED" />
      <circle cx="39" cy="39" r="5.2" fill="#EDEDED" />
    </svg>
  );
}

/** "Social" with the "by Gershon.AI" line under it. */
export function SocialWordmark({ dark = false }: { dark?: boolean }) {
  return (
    <div className="leading-tight">
      <div className={`text-[15px] font-bold tracking-tight ${dark ? "text-white" : "text-gray-900"}`}>Social</div>
      <div className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${dark ? "text-[#8E949F]" : "text-gray-500"}`}>
        by Gershon.AI
      </div>
    </div>
  );
}
