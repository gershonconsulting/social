"use client";

import { useState } from "react";
import { Bookmark, Copy, Check } from "lucide-react";

/**
 * ScrapeBookmarklet — a one-click "scrape this page" bookmarklet that
 * Olivier drags to his Chrome bookmarks bar. When clicked on any
 * LinkedIn /posts/ page or X profile page, it:
 *   1. Calls /api/scrape/resolve-client?url=<here> to find the matching
 *      clientId based on the page URL.
 *   2. Extracts the last 2 months of posts from the DOM.
 *   3. POSTs them to /api/scrape/import — same destination the manual
 *      Sync via Phantombuster button writes to.
 *
 * The bookmarklet has to be a same-origin fetch to social.gershoncrm.com,
 * which is fine because we explicitly set the absolute URL in the fetch
 * call. LinkedIn's CSP allows fetches to arbitrary HTTPS origins from
 * page-injected JS.
 */
const BOOKMARKLET_BODY = `
(async () => {
  const ORIGIN = 'https://social.gershoncrm.com';
  const here = location.href;
  const host = location.hostname.toLowerCase();
  let platform = null;
  if (host.includes('linkedin.com')) platform = 'LINKEDIN';
  else if (host.includes('twitter.com') || host.includes('x.com')) platform = 'TWITTER';
  if (!platform) { alert('Watchman: this only works on a LinkedIn /posts/ or X profile page.'); return; }

  // Tiny toast
  const toast = (msg, ok) => {
    const t = document.createElement('div');
    t.textContent = 'Watchman ' + msg;
    t.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:99999;padding:10px 14px;border-radius:8px;font:14px system-ui;color:#fff;background:' + (ok ? '#0a7' : '#c14') + ';box-shadow:0 4px 12px rgba(0,0,0,.3)';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 6000);
  };

  // Resolve clientId from URL
  let r = await fetch(ORIGIN + '/api/scrape/resolve-client?url=' + encodeURIComponent(here));
  let j = await r.json().catch(() => null);
  if (!j || !j.success) { toast('couldn\\'t resolve client: ' + (j && j.error || r.status), false); return; }
  const clientId = j.data.clientId;
  const clientName = j.data.clientName;
  toast('found ' + clientName + ', scrolling for posts…', true);

  // Gentle scroll: 5 nudges, 2s apart — past experience shows aggressive scrolling triggers LinkedIn anti-bot
  for (let i = 0; i < 5; i++) {
    window.scrollBy({ top: 1500, behavior: 'smooth' });
    await new Promise(r => setTimeout(r, 1800));
  }

  // ---------- extractor ----------
  const now = Date.now();
  const parseRel = (txt) => {
    if (!txt) return null;
    // Order matters — longer suffixes before single-letter ones, so '1mo' beats '1m'
    const m = txt.trim().toLowerCase().match(/(\\d+)\\s*(min|mo|month|hr|yr|s|m|h|d|w|y)/);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    const u = m[2];
    const delta = u==='s'?n*1000:(u==='m'||u==='min')?n*60000:(u==='h'||u==='hr')?n*3600000:u==='d'?n*86400000:u==='w'?n*604800000:(u==='mo'||u==='month')?n*2592000000:(u==='y'||u==='yr')?n*31536000000:0;
    return new Date(now - delta).toISOString();
  };
  const scaled = (numStr, suffix) => { let n=parseFloat((numStr||'0').replace(/,/g,'')); if(!isFinite(n))return 0; const s=(suffix||'').toLowerCase(); if(s==='k')n*=1000;else if(s==='m')n*=1000000; return Math.round(n); };
  const firstInt = (t) => { const m=t&&t.match(/([\\d,\\.]+)\\s*([KkMm]?)/); return m?scaled(m[1],m[2]):0; };
  const intAfter = (t, k) => { const m=t&&t.match(new RegExp('([\\\\d,\\\\.]+)\\\\s*([KkMm]?)\\\\s*'+k,'i')); return m?scaled(m[1],m[2]):0; };

  let posts = [];
  if (platform === 'LINKEDIN') {
    const findUrn = (el) => {
      let cur = el;
      for (let i=0;i<8&&cur;i++){const u=cur.getAttribute&&cur.getAttribute('data-urn');if(u&&u.includes('activity:'))return u;const id=cur.getAttribute&&cur.getAttribute('data-id');if(id&&id.includes('activity:'))return id;cur=cur.parentElement;}
      return null;
    };
    const containers = Array.from(document.querySelectorAll('div.feed-shared-update-v2'));
    const seen = new Set();
    for (const c of containers) {
      try {
        const urn = findUrn(c);
        if (!urn) continue;
        const idMatch = urn.match(/activity:(\\d{10,})/);
        if (!idMatch) continue;
        const id = idMatch[1];
        if (seen.has(id)) continue;
        seen.add(id);
        const textEl = c.querySelector('.update-components-text, .feed-shared-update-v2__description-wrapper, .update-components-update-v2__commentary');
        const text = textEl ? textEl.innerText.trim() : '';
        if (!text) continue;
        const subDescEl = c.querySelector('.update-components-actor__sub-description, .update-components-actor__sub-description-container');
        const timeText = subDescEl ? subDescEl.innerText.trim() : '';
        const publishedAtUtc = parseRel(timeText);
        if (!publishedAtUtc) continue;
        const statsEl = c.querySelector('.social-details-social-counts');
        const statsText = statsEl ? statsEl.innerText : '';
        posts.push({
          externalPostId: id,
          postUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:' + id + '/',
          text: text.slice(0, 500),
          publishedAtUtc,
          likeCount: firstInt(statsText),
          commentCount: intAfter(statsText, 'comment'),
          shareCount: intAfter(statsText, 'repost'),
          hasMedia: !!c.querySelector('img.feed-shared-image, video, .feed-shared-image, .update-components-image'),
        });
      } catch (e) {}
    }
  } else if (platform === 'TWITTER') {
    const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    const seen = new Set();
    for (const a of articles) {
      try {
        const textEl = a.querySelector('[data-testid="tweetText"]');
        const text = textEl ? textEl.innerText.trim() : '';
        const timeEl = a.querySelector('time');
        const iso = timeEl && timeEl.getAttribute('datetime');
        if (!text || !iso) continue;
        const anchor = timeEl.closest('a');
        const href = anchor ? anchor.href : '';
        const m = href.match(/\\/status\\/(\\d{8,})/);
        if (!m) continue;
        const id = m[1];
        if (seen.has(id)) continue;
        seen.add(id);
        const likeEl = a.querySelector('[data-testid="like"]');
        const replyEl = a.querySelector('[data-testid="reply"]');
        const rtEl = a.querySelector('[data-testid="retweet"]');
        const lt = likeEl ? likeEl.innerText : '';
        const rt = replyEl ? replyEl.innerText : '';
        const rwt = rtEl ? rtEl.innerText : '';
        posts.push({
          externalPostId: id,
          postUrl: href,
          text: text.slice(0, 500),
          publishedAtUtc: iso,
          likeCount: firstInt(lt),
          commentCount: firstInt(rt),
          shareCount: firstInt(rwt),
          hasMedia: !!a.querySelector('img[alt="Image"], video'),
        });
      } catch (e) {}
    }
  }

  if (posts.length === 0) {
    toast('found 0 posts on the page — is it the /posts/ tab or a profile feed?', false);
    return;
  }

  r = await fetch(ORIGIN + '/api/scrape/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, platform, posts }),
  });
  j = await r.json().catch(() => null);
  if (j && j.success) {
    toast('✅ ' + clientName + ' ' + platform + ': ' + j.data.postsUpserted + ' posts upserted', true);
  } else {
    toast('import failed: ' + (j && j.error || r.status), false);
  }
})();
`;

function makeHref(): string {
  // Compact the body into a single-line javascript: URL
  const compact = BOOKMARKLET_BODY.trim();
  return "javascript:" + encodeURIComponent(compact);
}

export function ScrapeBookmarklet() {
  const [copied, setCopied] = useState(false);
  const href = makeHref();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Bookmark size={16} className="text-red-600" />
        <h3 className="text-sm font-semibold text-gray-900">One-click scrape bookmarklet</h3>
      </div>
      <p className="text-xs text-gray-600 leading-relaxed">
        Drag the button below onto your Chrome bookmarks bar. Then visit any company&apos;s LinkedIn{" "}
        <code className="bg-gray-100 px-1 rounded">/posts/</code> tab or their X profile and click the
        bookmark — it scrapes the visible posts (gentle 10s scroll), looks up which client the page
        belongs to by URL, and writes the posts directly into your dashboard.
      </p>
      <div className="flex items-center gap-3">
        <a
          href={href}
          onClick={(e) => e.preventDefault()}
          draggable={true}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-red-600 text-white rounded-lg cursor-grab active:cursor-grabbing select-none"
          title="Drag this to your bookmarks bar"
        >
          <Bookmark size={14} /> Scrape this page
        </a>
        <button
          onClick={copy}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy as text"}
        </button>
      </div>
      <details className="text-xs text-gray-500">
        <summary className="cursor-pointer hover:text-gray-700">If drag-to-bookmarks doesn&apos;t work…</summary>
        <ol className="mt-2 ml-4 list-decimal space-y-1">
          <li>Right-click the bookmarks bar → Add page.</li>
          <li>Name: <code className="bg-gray-100 px-1 rounded">Scrape this page</code></li>
          <li>URL: paste the &quot;Copy as text&quot; value into the URL field.</li>
          <li>Save. The bookmark now works on any LinkedIn /posts/ or X profile page.</li>
        </ol>
      </details>
      <p className="text-[11px] text-gray-400">
        Tip: open one company&apos;s LinkedIn link directly from <code>/clients</code> in a new tab,
        click the bookmarklet, watch the green toast. Repeat for X. ~30s per company.
      </p>
    </div>
  );
}
