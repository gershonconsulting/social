/**
 * The Social mark — one icon for the whole product: browser tab (src/app/icon.svg),
 * Chrome extension (scripts/social-icon.mjs), sidebar, sign-in and home page.
 * Platform first, Gershon.AI second: "Social by Gershon.AI", like
 * Radar / Pulse / Company / Finance by Gershon.AI.
 */
export function SocialMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="social-mark-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FE1B04" />
          <stop offset="1" stopColor="#B3120A" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#social-mark-g)" />
      <path d="M21 32 L43 19 M21 32 L43 45" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
      <circle cx="21" cy="32" r="8" fill="#fff" />
      <circle cx="43" cy="19" r="7" fill="#fff" />
      <circle cx="43" cy="45" r="7" fill="#fff" />
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
