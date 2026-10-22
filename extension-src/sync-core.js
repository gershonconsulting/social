// Shared sync core — runs from popup AND from background alarm.
// Loaded into popup.html via <script> and into background.js via importScripts.
//
// v0.10.7 — navigate-and-DOM-scrape.
// Previously the scrape ran inside the home tab (/feed/, /home) and called
// the private voyager + v1.1 user_timeline endpoints. Both kept failing in
// 2026:
//   * LinkedIn voyager requires `csrf-token: <JSESSIONID>`, but JSESSIONID
//     is HttpOnly so the page-context IIFE cannot read it via document.cookie.
//     The csrf header went out empty -> 401/403 on every company-lookup.
//   * X `/i/api/1.1/statuses/user_timeline.json` has been gated behind the
//     paid API plan since 2023; the public web bearer no longer works.
// The new flow:
//   1. Capture session cookies (unchanged).
//   2. For each client, navigate the captured tab to the real profile page
//      (linkedin.com/company/<vanity>/posts/ or x.com/<handle>), wait for
//      the SPA to render, scroll a few times to lazy-load more posts, then
//      pull posts out of the rendered DOM. Same selectors social-watchman
//      uses in Playwright, which we know hit the right elements.
// DOM scraping is also fragile - when LinkedIn or X rotates a class name
// this returns zero posts. But that beats the previous "always returns an
// auth error" baseline, and the selectors are isolated at the top of each
// scraper for easy patching.

const PLATFORMS = [
  { name: "LINKEDIN", label: "LinkedIn", url: "https://www.linkedin.com/feed/", domains: ["linkedin.com", "www.linkedin.com", "fr.linkedin.com"], required: "li_at", names: ["li_at", "JSESSIONID", "liap", "lidc", "bcookie"] },
  { name: "TWITTER",  label: "X",        url: "https://x.com/home",             domains: ["x.com", "twitter.com"], required: "auth_token", names: ["auth_token", "ct0", "twid", "kdt"] }
];

const POST_NAV_SETTLE_MS = 5500;
const NAV_TIMEOUT_MS = 25000;
const SCROLL_PASSES = 6;

async function attemptLinkedInAutoLogin(tabId, runLog) {
  runLog.push({ at: Date.now(), step: "LINKEDIN:auto-reauth-start" });
  try { await chrome.tabs.update(tabId, { active: true }); } catch (e) {}
  await new Promise(function (r) { setTimeout(r, 2500); });
  let landingInfo = null;
  try {
    const probe = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function () {
        const text = (document.body && document.body.innerText || "").slice(0, 400);
        return { url: location.href, title: document.title, snippet: text.replace(/\s+/g, " ") };
      }
    });
    landingInfo = (probe && probe[0] && probe[0].result) || null;
  } catch (e) {}
  if (landingInfo) runLog.push({ at: Date.now(), step: "LINKEDIN:auto-reauth-landing", detail: landingInfo });
  let stepCClicked = null;
  try {
    const r1 = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function () {
        function visible(el) {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }
        const queries = [
          'button[data-tracking-control-name*="member_card"]',
          'a[data-tracking-control-name*="member_card"]',
          'button[data-tracking-control-name*="sign-in_signin"]',
          '.member-profile-block button',
          '.member-profile-block',
          'button.profile-card__sign-in-form-button'
        ];
        for (const q of queries) {
          const els = Array.from(document.querySelectorAll(q)).filter(visible);
          if (els.length) { els[0].click(); return { method: q, text: (els[0].innerText||"").slice(0,80) }; }
        }
        const buttons = Array.from(document.querySelectorAll("button, a")).filter(visible);
        const m = buttons.find(function (b) {
          const t = (b.innerText || b.textContent || "").trim();
          return /sign in as/i.test(t) || /@/.test(t);
        });
        if (m) { m.click(); return { method: "text-match", text: (m.innerText||"").slice(0,80) }; }
        return { method: null };
      }
    });
    stepCClicked = (r1 && r1[0] && r1[0].result) || null;
  } catch (e) {
    stepCClicked = { error: (e && e.message) || String(e) };
  }
  runLog.push({ at: Date.now(), step: "LINKEDIN:auto-reauth-click-account", detail: stepCClicked });
  await new Promise(function (r) { setTimeout(r, 4500); });
  let stepDSubmit = null;
  try {
    const r2 = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function () {
        const out = {};
        const pwd = document.querySelector("input[name='session_password'], input#password, input[type='password']");
        if (pwd) {
          try { pwd.focus(); pwd.click(); } catch (_) {}
          out.passwordPrefilled = !!pwd.value;
        } else {
          out.passwordInputFound = false;
        }
        const btn =
          document.querySelector("button[type='submit'][aria-label*='Sign in' i]") ||
          document.querySelector("button[data-litms-control-urn*='login-submit']") ||
          Array.from(document.querySelectorAll("button[type='submit']"))[0] ||
          Array.from(document.querySelectorAll("button")).find(function (b) { return /sign in/i.test(b.innerText); });
        if (btn) { btn.click(); out.submitClicked = true; }
        else {
          const form = document.querySelector("form.login__form, form[action*='login-submit'], form[action*='checkpoint']");
          if (form) { form.submit(); out.formSubmitted = true; }
        }
        return out;
      }
    });
    stepDSubmit = (r2 && r2[0] && r2[0].result) || null;
  } catch (e) {
    stepDSubmit = { error: (e && e.message) || String(e) };
  }
  runLog.push({ at: Date.now(), step: "LINKEDIN:auto-reauth-submit", detail: stepDSubmit });
  await new Promise(function (r) { setTimeout(r, 7000); });
  runLog.push({ at: Date.now(), step: "LINKEDIN:auto-reauth-done" });
}

async function captureOne(p, origin, runLog) {
  runLog.push({ at: Date.now(), step: p.name + ":open-tab", detail: { url: p.url } });
  const tab = await chrome.tabs.create({ url: p.url, active: false });
  const settleMs = 7000;
  await new Promise(function (r) { setTimeout(r, settleMs); });
  const cookies = {};
  const domains = p.domains || [p.domain];
  for (const name of p.names) {
    let best = null;
    for (const domain of domains) {
      try {
        const cs = await chrome.cookies.getAll({ domain: domain, name: name });
        if (cs && cs.length > 0) {
          cs.sort(function (a, b) { return (b.expirationDate || 0) - (a.expirationDate || 0); });
          if (!best || (cs[0].expirationDate || 0) > (best.expirationDate || 0)) {
            best = cs[0];
          }
        }
      } catch (e) {}
    }
    if (!best) {
      try {
        const cs = await chrome.cookies.getAll({ name: name });
        const filtered = (cs || []).filter(function (c) {
          const d = (c.domain || "").replace(/^\./, "");
          return domains.some(function (cd) { return d === cd || d.endsWith("." + cd); });
        });
        filtered.sort(function (a, b) { return (b.expirationDate || 0) - (a.expirationDate || 0); });
        if (filtered.length > 0) best = filtered[0];
      } catch (e) {}
    }
    if (best) cookies[name] = best.value;
  }
  runLog.push({
    at: Date.now(),
    step: p.name + ":cookies-summary",
    detail: {
      domainsChecked: p.domains || [p.domain],
      cookiesFound: Object.keys(cookies),
      cookiesMissing: p.names.filter(function (n) { return !cookies[n]; }),
      requiredCookie: p.required,
      requiredPresent: !!cookies[p.required]
    }
  });
  if (!cookies[p.required]) {
    if (p.name === "LINKEDIN") {
      runLog.push({ at: Date.now(), step: p.name + ":required-missing-attempting-reauth" });
      await attemptLinkedInAutoLogin(tab.id, runLog);
      for (const name of p.names) {
        if (cookies[name]) continue;
        for (const domain of domains) {
          try {
            const cs2 = await chrome.cookies.getAll({ domain: domain, name: name });
            if (cs2 && cs2.length > 0) {
              cs2.sort(function (a, b) { return (b.expirationDate || 0) - (a.expirationDate || 0); });
              cookies[name] = cs2[0].value;
              break;
            }
          } catch (e) {}
        }
      }
      runLog.push({
        at: Date.now(),
        step: p.name + ":cookies-after-reauth",
        detail: {
          cookiesFound: Object.keys(cookies),
          cookiesMissing: p.names.filter(function (n) { return !cookies[n]; }),
          requiredPresent: !!cookies[p.required]
        }
      });
    }
  }
  if (!cookies[p.required]) {
    runLog.push({ at: Date.now(), step: p.name + ":capture-FAILED", detail: { reason: "required cookie '" + p.required + "' not found in any candidate domain - you may not be logged in to " + p.label + " in this Chrome profile" } });
    try { await chrome.tabs.update(tab.id, { active: true }); } catch (e) {}
    return { ok: false, error: "not logged in to " + p.label + " - tab left open for inspection", tabId: tab.id };
  }
  let resp;
  try {
    resp = await fetch(origin + "/api/cookies/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: p.name, cookies: cookies, capturedAt: new Date().toISOString() })
    });
  } catch (e) {
    try { await chrome.tabs.remove(tab.id); } catch (e2) {}
    return { ok: false, error: "network: " + String(e).slice(0, 40), tabId: null };
  }
  if (!resp.ok) {
    try { await chrome.tabs.remove(tab.id); } catch (e) {}
    return { ok: false, error: "server " + resp.status, tabId: null };
  }
  let j = null;
  try { j = await resp.json(); } catch (e) {}
  if (!j || !j.success) {
    try { await chrome.tabs.remove(tab.id); } catch (e) {}
    return { ok: false, error: (j && j.error) || "rejected", tabId: null };
  }
  const r = await chrome.storage.local.get("lastCapture");
  const lastCapture = r.lastCapture || {};
  lastCapture[p.name] = { at: Date.now(), cookieCount: Object.keys(cookies).length };
  await chrome.storage.local.set({ lastCapture: lastCapture });
  runLog.push({ at: Date.now(), step: p.name + ":capture-OK", detail: { cookieCount: Object.keys(cookies).length } });
  return { ok: true, cookieCount: Object.keys(cookies).length, tabId: tab.id };
}

async function fetchClients(origin) {
  const r = await fetch(origin + "/api/extension/clients", { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  if (!j || !j.success) throw new Error((j && j.error) || "rejected");
  return j.data.clients || [];
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise(function (resolve) {
    let settled = false;
    function listener(updatedTabId, info) {
      if (updatedTabId !== tabId) return;
      if (info.status !== "complete") return;
      if (settled) return;
      settled = true;
      try { chrome.tabs.onUpdated.removeListener(listener); } catch (e) {}
      resolve(true);
    }
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(function () {
      if (settled) return;
      settled = true;
      try { chrome.tabs.onUpdated.removeListener(listener); } catch (e) {}
      resolve(false);
    }, timeoutMs);
  });
}

function linkedinDomScraper(scrollPasses) {
  return new Promise(function (resolve) {
    function parseRelative(text) {
      if (!text) return null;
      const m = text.trim().toLowerCase().match(/(\d+)\s*(min|mo|month|hr|yr|s|m|h|d|w|y)/);
      if (!m) return null;
      const n = parseInt(m[1], 10);
      const u = m[2];
      var ms;
      if (u === "s") ms = n * 1000;
      else if (u === "m" || u === "min") ms = n * 60000;
      else if (u === "h" || u === "hr") ms = n * 3600000;
      else if (u === "d") ms = n * 86400000;
      else if (u === "w") ms = n * 7 * 86400000;
      else if (u === "mo" || u === "month") ms = n * 30 * 86400000;
      else if (u === "y" || u === "yr") ms = n * 365 * 86400000;
      else ms = 0;
      return new Date(Date.now() - ms);
    }
    function scaled(numStr, suffix) {
      var n = parseFloat(String(numStr).replace(/,/g, ""));
      if (!isFinite(n)) return 0;
      var s = (suffix || "").toLowerCase();
      if (s === "k") n *= 1000;
      else if (s === "m") n *= 1000000;
      return Math.round(n);
    }
    function firstInt(text) {
      if (!text) return 0;
      var m = text.match(/([\d,\.]+)\s*([KkMm]?)/);
      return m ? scaled(m[1], m[2]) : 0;
    }
    function intAfter(text, kw) {
      if (!text) return 0;
      var re = new RegExp("([\\d,\\.]+)\\s*([KkMm]?)\\s*" + kw, "i");
      var m = text.match(re);
      return m ? scaled(m[1], m[2]) : 0;
    }
    var url = location.href || "";
    if (/\/(login|uas\/login|checkpoint)/i.test(url)) {
      resolve({ posts: [], error: "landed on LinkedIn login wall (session expired)" });
      return;
    }
    var passes = 0;
    var scrollTimer = setInterval(function () {
      try { window.scrollBy(0, 1800); } catch (_) {}
      passes++;
      if (passes >= (scrollPasses || 6)) {
        clearInterval(scrollTimer);
        setTimeout(harvest, 1800);
      }
    }, 900);
    function harvest() {
      try {
        var cards = document.querySelectorAll("div.feed-shared-update-v2, div.update-components-update-v2");
        if (!cards.length) {
          var bodyText = (document.body && document.body.innerText || "").slice(0, 400);
          if (/no posts yet|hasn'?t posted|isn'?t available/i.test(bodyText)) {
            resolve({ posts: [], error: "no posts on this company page" });
          } else {
            resolve({ posts: [], error: "no post cards found (selectors may have changed)" });
          }
          return;
        }
        var posts = [];
        var seen = {};
        for (var i = 0; i < cards.length; i++) {
          try {
            var card = cards[i];
            var textEl = card.querySelector(".update-components-text, .feed-shared-update-v2__description-wrapper");
            var text = textEl ? (textEl.innerText || "").trim() : "";
            var timeEl = card.querySelector(".update-components-actor__sub-description span");
            var timeStr = timeEl ? (timeEl.innerText || "").trim() : "";
            var linkEl = card.querySelector("a[href*='urn:li:activity:'], a[href*='/feed/update/']");
            var href = linkEl ? (linkEl.getAttribute("href") || "") : "";
            if (href && href.indexOf("/") === 0) href = "https://www.linkedin.com" + href;
            if (!text || !href) continue;
            var idMatch = href.match(/activity[:-](\d{10,})/);
            if (!idMatch) continue;
            var externalPostId = idMatch[1];
            if (seen[externalPostId]) continue;
            seen[externalPostId] = true;
            var publishedAt = parseRelative(timeStr) || new Date();
            var statsEl = card.querySelector(".social-details-social-counts");
            var statsText = statsEl ? (statsEl.innerText || "") : "";
            var likeCount = firstInt(statsText);
            var commentCount = intAfter(statsText, "comment");
            var shareCount = intAfter(statsText, "repost");
            var hasMedia = !!card.querySelector("img.feed-shared-update-v2__image, video, .update-components-image, .update-components-video");
            posts.push({
              externalPostId: externalPostId,
              postUrl: href.split("?")[0],
              postTextSnippet: text.slice(0, 280),
              hasMedia: hasMedia,
              publishedAtUtc: publishedAt.toISOString(),
              likeCount: likeCount,
              commentCount: commentCount,
              shareCount: shareCount,
              rawPayload: { source: "extension-v0.10.7-dom", timeText: timeStr.slice(0, 60), statsText: statsText.slice(0, 200) }
            });
          } catch (_) {}
        }
        resolve({ posts: posts });
      } catch (e) {
        resolve({ posts: [], error: "scrape exception: " + ((e && e.message) || String(e)).slice(0, 200) });
      }
    }
  });
}

function twitterDomScraper(scrollPasses) {
  return new Promise(function (resolve) {
    function scaled(numStr, suffix) {
      var n = parseFloat(String(numStr).replace(/,/g, ""));
      if (!isFinite(n)) return 0;
      var s = (suffix || "").toLowerCase();
      if (s === "k") n *= 1000;
      else if (s === "m") n *= 1000000;
      return Math.round(n);
    }
    function testidCount(card, sel) {
      var e = card.querySelector(sel);
      if (!e) return 0;
      var t = (e.innerText || "").trim();
      var m = t.match(/([\d,\.]+)\s*([KkMm]?)/);
      return m ? scaled(m[1], m[2]) : 0;
    }
    var url = location.href || "";
    if (/\/i\/flow\/login|\/login/i.test(url)) {
      resolve({ posts: [], error: "landed on X login wall (session expired)" });
      return;
    }
    var passes = 0;
    var scrollTimer = setInterval(function () {
      try { window.scrollBy(0, 1800); } catch (_) {}
      passes++;
      if (passes >= (scrollPasses || 6)) {
        clearInterval(scrollTimer);
        setTimeout(harvest, 1800);
      }
    }, 900);
    function harvest() {
      try {
        var cards = document.querySelectorAll("article[data-testid='tweet']");
        if (!cards.length) {
          var bodyText = (document.body && document.body.innerText || "").slice(0, 400);
          if (/account suspended|doesn'?t exist|this account is private/i.test(bodyText)) {
            resolve({ posts: [], error: "X profile inaccessible: " + bodyText.slice(0, 80) });
          } else {
            resolve({ posts: [], error: "no tweet cards found (selectors may have changed)" });
          }
          return;
        }
        var posts = [];
        var seen = {};
        for (var i = 0; i < cards.length; i++) {
          try {
            var card = cards[i];
            var sc = card.querySelector("[data-testid='socialContext']");
            if (sc) {
              var scText = (sc.innerText || "").toLowerCase();
              if (scText.indexOf("replying to") !== -1) continue;
            }
            var textEl = card.querySelector("[data-testid='tweetText']");
            var text = textEl ? (textEl.innerText || "").trim() : "";
            var timeEl = card.querySelector("time");
            var timeIso = timeEl ? timeEl.getAttribute("datetime") : null;
            if (!timeIso) continue;
            var anchor = timeEl.closest("a");
            var href = anchor ? (anchor.getAttribute("href") || "") : "";
            var idMatch = href.match(/\/status\/(\d{8,})/);
            if (!idMatch) continue;
            var externalPostId = idMatch[1];
            if (seen[externalPostId]) continue;
            seen[externalPostId] = true;
            var postUrl = "https://x.com" + href.split("?")[0];
            var likeCount = testidCount(card, "[data-testid='like']");
            var commentCount = testidCount(card, "[data-testid='reply']");
            var shareCount = testidCount(card, "[data-testid='retweet']");
            var hasMedia = !!card.querySelector("img[src*='media'], video, [data-testid='videoComponent']");
            posts.push({
              externalPostId: externalPostId,
              postUrl: postUrl,
              postTextSnippet: text.slice(0, 280),
              hasMedia: hasMedia,
              publishedAtUtc: timeIso,
              likeCount: likeCount,
              commentCount: commentCount,
              shareCount: shareCount,
              viewCount: 0,
              rawPayload: { source: "extension-v0.10.7-dom", timeISO: timeIso }
            });
          } catch (_) {}
        }
        resolve({ posts: posts });
      } catch (e) {
        resolve({ posts: [], error: "scrape exception: " + ((e && e.message) || String(e)).slice(0, 200) });
      }
    }
  });
}

async function navigateAndScrape(tabId, targetUrl, scrapeFunc, runLog, label, passes) {
  runLog.push({ at: Date.now(), step: label + ":navigate", detail: { url: targetUrl } });
  try {
    await chrome.tabs.update(tabId, { url: targetUrl });
  } catch (e) {
    return { posts: [], error: "tabs.update failed: " + ((e && e.message) || String(e)).slice(0, 120) };
  }
  await waitForTabComplete(tabId, NAV_TIMEOUT_MS);
  await new Promise(function (r) { setTimeout(r, POST_NAV_SETTLE_MS); });
  try {
    const exec = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: scrapeFunc,
      args: [passes || SCROLL_PASSES]
    });
    const result = (exec && exec[0] && exec[0].result) || { posts: [], error: "no scrape result" };
    runLog.push({
      at: Date.now(),
      step: label + ":scrape-done",
      detail: {
        postCount: Array.isArray(result.posts) ? result.posts.length : 0,
        error: result.error || null
      }
    });
    return result;
  } catch (e) {
    return { posts: [], error: "executeScript: " + ((e && e.message) || String(e)).slice(0, 200) };
  }
}

async function ingest(origin, results) {
  if (!results.length) return { totalUpserted: 0, totalAttempts: 0, failed: 0, perClient: [] };
  const r = await fetch(origin + "/api/extension/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ results: results, source: "extension-v0.10.7" })
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  if (!j || !j.success) throw new Error((j && j.error) || "rejected");
  return j.data || { totalUpserted: 0, totalAttempts: 0, failed: 0, perClient: [] };
}

async function runFullSync(opts) {
  const origin = (opts && opts.origin) || "https://social.gershon.ai";
  const onProgress = (opts && opts.onProgress) || function () {};
  const runLog = [];
  const runStarted = Date.now();
  const cidFilter = (opts && opts.clientIdFilter) || null;
  // 0.25.0: "full history" for one company scrolls ~8x further back.
  const passes = (opts && opts.deep && cidFilter) ? 48 : SCROLL_PASSES;
  runLog.push({ at: runStarted, step: "run:start", detail: { origin: origin, version: chrome.runtime.getManifest().version, clientIdFilter: cidFilter } });

  onProgress("Fetching client list…", "info");
  let clients;
  try {
    clients = await fetchClients(origin);
  } catch (e2) {
    runLog.push({ at: Date.now(), step: "fetchClients:FAILED", detail: { error: (e2 && e2.message) || String(e2) } });
    return { ok: false, totalUpserted: 0, totalFailed: 0, accountCount: 0, badPlatforms: [], ingestErrors: ["client-fetch: " + ((e2 && e2.message) || e2)], log: runLog };
  }

  const liClientsCandidates = clients.filter(function (c) { return !!c.linkedin && (!cidFilter || c.id === cidFilter); });
  const twClientsCandidates = clients.filter(function (c) { return !!c.twitter && (!cidFilter || c.id === cidFilter); });
  const platformsToCapture = PLATFORMS.filter(function (p) {
    if (p.name === "LINKEDIN") return liClientsCandidates.length > 0;
    if (p.name === "TWITTER") return twClientsCandidates.length > 0;
    return false;
  });
  runLog.push({
    at: Date.now(),
    step: "plan",
    detail: {
      totalClients: clients.length,
      liClientsToScrape: liClientsCandidates.length,
      twClientsToScrape: twClientsCandidates.length,
      platformsToCapture: platformsToCapture.map(function (p) { return p.name; }),
      skipped: PLATFORMS.filter(function (p) { return !platformsToCapture.find(function (q) { return q.name === p.name; }); }).map(function (p) { return p.name + " (no clients in scope)"; })
    }
  });

  if (platformsToCapture.length === 0) {
    runLog.push({ at: Date.now(), step: "run:nothing-to-do", detail: { reason: cidFilter ? "filtered client has no LinkedIn or X link" : "no clients with any platform link" } });
    return { ok: false, totalUpserted: 0, totalFailed: 0, accountCount: 0, badPlatforms: [], ingestErrors: ["nothing to scrape for this client"], log: runLog };
  }

  onProgress("Opening " + platformsToCapture.map(function (p) { return p.label; }).join(" + ") + " to capture sessions…", "info");
  const captureResults = {};
  for (const p of platformsToCapture) {
    onProgress("Capturing " + p.label + " session…", "info");
    captureResults[p.name] = await captureOne(p, origin, runLog);
  }
  const goodPlatforms = Object.keys(captureResults).filter(function (k) { return captureResults[k].ok; });
  const badPlatforms  = Object.keys(captureResults).filter(function (k) { return !captureResults[k].ok; });
  if (goodPlatforms.length === 0) {
    return { ok: false, totalUpserted: 0, totalFailed: 0, accountCount: 0, badPlatforms: badPlatforms, ingestErrors: ["all cookie captures failed"], log: runLog };
  }

  const liClients = (captureResults.LINKEDIN && captureResults.LINKEDIN.ok) ? liClientsCandidates : [];
  const twClients = (captureResults.TWITTER && captureResults.TWITTER.ok) ? twClientsCandidates : [];

  const liResults = [];
  const twResults = [];

  if (liClients.length && captureResults.LINKEDIN.tabId) {
    onProgress("Scraping LinkedIn (" + liClients.length + " companies)…", "info");
    for (let i = 0; i < liClients.length; i++) {
      const c = liClients[i];
      onProgress("LinkedIn: " + (c.name || c.linkedin.vanity) + " (" + (i + 1) + "/" + liClients.length + ")…", "info");
      const url = "https://www.linkedin.com/company/" + encodeURIComponent(c.linkedin.vanity) + "/posts/?feedView=all";
      const r = await navigateAndScrape(captureResults.LINKEDIN.tabId, url, linkedinDomScraper, runLog, "LINKEDIN:" + c.linkedin.vanity, passes);
      liResults.push({
        clientId: c.id,
        connectionId: c.linkedin.connectionId,
        platform: "LINKEDIN",
        posts: r.posts || [],
        error: r.error || undefined
      });
    }
  }

  if (twClients.length && captureResults.TWITTER.tabId) {
    onProgress("Scraping X (" + twClients.length + " accounts)…", "info");
    for (let i = 0; i < twClients.length; i++) {
      const c = twClients[i];
      onProgress("X: @" + c.twitter.handle + " (" + (i + 1) + "/" + twClients.length + ")…", "info");
      const url = "https://x.com/" + encodeURIComponent(c.twitter.handle);
      const r = await navigateAndScrape(captureResults.TWITTER.tabId, url, twitterDomScraper, runLog, "TWITTER:@" + c.twitter.handle, passes);
      twResults.push({
        clientId: c.id,
        connectionId: c.twitter.connectionId,
        platform: "TWITTER",
        posts: r.posts || [],
        error: r.error || undefined
      });
    }
  }

  let totalUpserted = 0;
  let totalFailed = 0;
  const ingestErrors = [];

  const allResults = liResults.concat(twResults);
  if (allResults.length) {
    try {
      const out = await ingest(origin, allResults);
      totalUpserted += out.totalUpserted || 0;
      totalFailed += out.failed || 0;
      if (Array.isArray(out.perClient)) {
        for (const pc of out.perClient) {
          if (pc.error) {
            const label = pc.platform === "TWITTER" ? "X" : pc.platform;
            ingestErrors.push(label + ": " + pc.error);
          }
        }
      }
    } catch (e) {
      ingestErrors.push("ingest: " + ((e && e.message) || e));
    }
  }

  if (captureResults.LINKEDIN && captureResults.LINKEDIN.tabId) {
    try { await chrome.tabs.remove(captureResults.LINKEDIN.tabId); } catch (e) {}
  }
  if (captureResults.TWITTER && captureResults.TWITTER.tabId) {
    try { await chrome.tabs.update(captureResults.TWITTER.tabId, { active: true }); } catch (e) {}
  }

  runLog.push({
    at: Date.now(),
    step: "run:done",
    detail: {
      totalUpserted: totalUpserted,
      totalFailed: totalFailed,
      liClientsScraped: liClients.length,
      twClientsScraped: twClients.length,
      badPlatforms: badPlatforms,
      ingestErrors: ingestErrors,
      durationMs: Date.now() - runStarted
    }
  });

  const lastRunPayload = {
    at: Date.now(),
    durationMs: Date.now() - runStarted,
    totalUpserted: totalUpserted,
    totalFailed: totalFailed,
    accountCount: liClients.length + twClients.length,
    badPlatforms: badPlatforms,
    ingestErrors: ingestErrors,
    log: runLog
  };
  await chrome.storage.local.set({ lastAutoSync: lastRunPayload, lastRunDetail: lastRunPayload });

  return {
    ok: true,
    totalUpserted: totalUpserted,
    totalFailed: totalFailed,
    accountCount: liClients.length + twClients.length,
    badPlatforms: badPlatforms,
    ingestErrors: ingestErrors,
    log: runLog
  };
}

if (typeof self !== "undefined") { self.runFullSync = runFullSync; }
if (typeof window !== "undefined") { window.runFullSync = runFullSync; }
