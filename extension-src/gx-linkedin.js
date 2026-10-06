// LinkedIn company-page reader for LinkedIn's new page layout. (extension 0.13.2)
//
// 0.13.2 — WRONG OR DEAD LINKS ARE NAMED. A tracked company whose LinkedIn link
// leads nowhere ("This page doesn't exist", /company/unavailable/) used to come
// back as "no posts on this company page", indistinguishable from a quiet
// company. It now returns an error starting with PAGE_UNAVAILABLE, which the
// daily report lists under "LinkedIn links to fix". Every post also carries the
// name printed on the page (rawPayload.pageName) so the server can flag a link
// that opens a different company's page (PAGE_MISMATCH).
//
// In autumn 2026 LinkedIn moved company pages to a new layout: the old post
// containers (div.feed-shared-update-v2) and their class names are gone, and
// posts no longer carry a link with their activity id. The collector's reader
// looked only for the old containers, found none, and sent back nothing — so a
// company that posts every week (Cytel, 2026-10-04) showed "Has never posted".
//
// This reader finds posts the way the page presents them: each post is a block
// headed "Feed post" with a "control menu for post by <company>" button. Ads
// (same heading, no control menu) are skipped. From each block it reads the
// date line ("Sep 30 • Edited •", "2d •", "3w •", "1mo •"), the post text, the
// counts, and whether there is media.
//
// Identity: the new layout no longer exposes the post id, so each post is keyed
// by a fingerprint of company + its opening text ("lih-…"). If an old-style
// activity id is still present it is used instead. The server matches a
// fingerprint to a post it already holds under its old id (same company, same
// opening text) so nothing is counted twice.
//
// If the old layout is served, the old containers are read as before.
// A page that shows posts but yields none reports an error instead of
// "no posts", so the dashboard never again says "never posted" by mistake.
//
// Must stay self-contained: it is serialised into the page by
// chrome.scripting.executeScript.

self.linkedinDomScraper = function (scrollPasses) {
  return new Promise(function (resolve) {
    var MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    function parseDate(text) {
      if (!text) return null;
      var t = text.trim().toLowerCase();
      var m = t.match(/^(\d+)\s*(s|m|min|h|hr|d|w|mo|yr|y)\b/);
      if (m) {
        var n = parseInt(m[1], 10), u = m[2], ms = 0;
        if (u === "s") ms = n * 1000;
        else if (u === "m" || u === "min") ms = n * 60000;
        else if (u === "h" || u === "hr") ms = n * 3600000;
        else if (u === "d") ms = n * 86400000;
        else if (u === "w") ms = n * 7 * 86400000;
        else if (u === "mo") ms = n * 30 * 86400000;
        else ms = n * 365 * 86400000;
        return new Date(Date.now() - ms);
      }
      m = t.match(/^([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,\s*(\d{4}))?/);
      if (m && MONTHS[m[1]] !== undefined) {
        var now = new Date();
        var y = m[3] ? parseInt(m[3], 10) : now.getFullYear();
        var d = new Date(Date.UTC(y, MONTHS[m[1]], parseInt(m[2], 10), 12));
        if (!m[3] && d.getTime() > now.getTime() + 86400000) d = new Date(Date.UTC(y - 1, MONTHS[m[1]], parseInt(m[2], 10), 12));
        return d;
      }
      return null;
    }
    function num(s) {
      var m = String(s).replace(/,/g, "").match(/^([\d.]+)\s*([KkMm]?)$/);
      if (!m) return null;
      var n = parseFloat(m[1]);
      if (m[2] === "K" || m[2] === "k") n *= 1000;
      if (m[2] === "M" || m[2] === "m") n *= 1000000;
      return Math.round(n);
    }
    function fingerprint(s) {
      var h1 = 0x811c9dc5, h2 = 0x01000193;
      for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
        h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
      }
      return ("00000000" + h1.toString(16)).slice(-8) + ("00000000" + h2.toString(16)).slice(-8);
    }
    function vanity() {
      var m = location.pathname.match(/\/company\/([^/]+)/);
      return m ? decodeURIComponent(m[1]).toLowerCase() : "";
    }

    var url = location.href || "";
    if (/\/(login|uas\/login|checkpoint|authwall)/i.test(url)) {
      resolve({ posts: [], error: "landed on LinkedIn login wall (session expired)" });
      return;
    }

    var UNAVAILABLE_TEXT = /this page (doesn[\u2019']?t|does not) exist|page not found|this (linkedin )?page (isn[\u2019']?t|is not) available|this page is (no longer|not) available|company (is )?unavailable/i;
    function unavailable() {
      var u = location.href || "";
      if (/\/company\/unavailable\b|\/404\b|linkedin\.com\/?(\?|#|$)|\/feed\/?(\?|#|$)/i.test(u)) return u;
      var head = ((document.body && document.body.innerText) || "").slice(0, 3000);
      return UNAVAILABLE_TEXT.test(head) ? u : null;
    }
    function pageName() {
      try {
        var h = document.querySelector("h1");
        var t = h ? (h.innerText || "").trim() : "";
        if (!t) t = String(document.title || "").split(/\s[|:]\s|:\s/)[0].trim();
        return t.replace(/\s+/g, " ").slice(0, 120);
      } catch (_) { return ""; }
    }
    var dead = unavailable();
    if (dead) {
      resolve({ posts: [], error: "PAGE_UNAVAILABLE: LinkedIn shows no company page at this link (it opened " + dead.slice(0, 120) + ")" });
      return;
    }

    var passes = 0;
    var timer = setInterval(function () {
      try { window.scrollBy(0, 1800); } catch (_) {}
      passes++;
      if (passes >= (scrollPasses || 6)) { clearInterval(timer); setTimeout(harvest, 2000); }
    }, 1000);

    function readNew() {
      var buttons = document.querySelectorAll('button[aria-label^="Open control menu for post"]');
      var posts = [], seen = {}, pageUrl = location.origin + location.pathname;
      var v = vanity();
      for (var i = 0; i < buttons.length; i++) {
        try {
          var card = buttons[i];
          for (var k = 0; k < 16 && card.parentElement; k++) {
            var up = card.parentElement;
            if (((up.innerText || "").match(/Feed post/g) || []).length > 1) break;
            card = up;
          }
          var lines = (card.innerText || "").split("\n").map(function (s) { return s.replace(/\u200b/g, "").trim(); }).filter(Boolean);
          var di = -1;
          for (var j = 0; j < Math.min(lines.length, 8); j++) {
            if (/•/.test(lines[j]) && parseDate(lines[j].split("•")[0])) { di = j; break; }
          }
          if (di < 0) continue;
          var publishedAt = parseDate(lines[di].split("•")[0]);
          var start = di + 1;
          if (lines[start] === "Follow" || lines[start] === "Following") start++;
          var body = [];
          var tailNums = [];
          for (var q = start; q < lines.length; q++) {
            var L = lines[q];
            if (/^…\s*more$/.test(L) || L === "·") break;
            if (num(L) !== null && q > start) break;
            body.push(L);
          }
          for (var r2 = lines.length - 1; r2 >= 0 && tailNums.length < 4; r2--) {
            var nv = num(lines[r2]);
            if (nv === null) break;
            tailNums.unshift(nv);
          }
          var text = body.join("\n").trim();
          if (!text) continue;
          var html = card.innerHTML || "";
          var act = html.match(/urn:li:activity:(\d{15,20})/);
          var id = act ? act[1] : "lih-" + fingerprint(v + "|" + text.replace(/\s+/g, " ").slice(0, 160));
          if (seen[id]) continue;
          seen[id] = true;
          posts.push({
            externalPostId: id,
            postUrl: act ? "https://www.linkedin.com/feed/update/urn:li:activity:" + act[1] + "/" : pageUrl,
            postTextSnippet: text.slice(0, 280),
            hasMedia: !!card.querySelector("img[src*='media'], video, [aria-label*='page of document']"),
            publishedAtUtc: (publishedAt || new Date()).toISOString(),
            likeCount: tailNums[0] || 0,
            commentCount: tailNums.length >= 2 ? tailNums[1] : 0,
            shareCount: tailNums.length >= 3 ? tailNums[2] : 0,
            rawPayload: { source: "extension-v0.13.2-sdui", dateText: lines[di].slice(0, 60), counts: tailNums }
          });
        } catch (_) {}
      }
      return posts;
    }

    function readOld() {
      var cards = document.querySelectorAll("div.feed-shared-update-v2, div.update-components-update-v2");
      var posts = [], seen = {};
      for (var i = 0; i < cards.length; i++) {
        try {
          var card = cards[i];
          var textEl = card.querySelector(".update-components-text, .feed-shared-update-v2__description-wrapper");
          var text = textEl ? (textEl.innerText || "").trim() : "";
          var urn = card.getAttribute("data-urn") || "";
          var linkEl = card.querySelector("a[href*='urn:li:activity:'], a[href*='/feed/update/']");
          var href = linkEl ? (linkEl.getAttribute("href") || "") : "";
          var idm = (urn + " " + href).match(/activity[:-](\d{10,})/);
          if (!text || !idm || seen[idm[1]]) continue;
          seen[idm[1]] = true;
          var timeEl = card.querySelector(".update-components-actor__sub-description span");
          var timeStr = timeEl ? (timeEl.innerText || "").trim() : "";
          posts.push({
            externalPostId: idm[1],
            postUrl: "https://www.linkedin.com/feed/update/urn:li:activity:" + idm[1] + "/",
            postTextSnippet: text.slice(0, 280),
            hasMedia: !!card.querySelector("video, .update-components-image, .update-components-video"),
            publishedAtUtc: (parseDate(timeStr.split("•")[0]) || new Date()).toISOString(),
            likeCount: 0, commentCount: 0, shareCount: 0,
            rawPayload: { source: "extension-v0.13.2-legacy", timeText: timeStr.slice(0, 60) }
          });
        } catch (_) {}
      }
      return posts;
    }

    function harvest() {
      try {
        var posts = readNew();
        if (!posts.length) posts = readOld();
        if (posts.length) {
          var name = pageName();
          if (name) posts.forEach(function (p) { p.rawPayload = Object.assign({}, p.rawPayload || {}, { pageName: name, pageUrl: location.href.slice(0, 200) }); });
          resolve({ posts: posts });
          return;
        }
        var deadNow = unavailable();
        if (deadNow) {
          resolve({ posts: [], error: "PAGE_UNAVAILABLE: LinkedIn shows no company page at this link (it opened " + deadNow.slice(0, 120) + ")" });
          return;
        }
        var bodyText = (document.body && document.body.innerText || "");
        if (/no posts yet|hasn'?t posted/i.test(bodyText.slice(0, 4000))) {
          resolve({ posts: [], error: "no posts on this company page" });
        } else if (/Feed post/.test(bodyText)) {
          resolve({ posts: [], error: "posts are on the page but none could be read (LinkedIn layout changed again)" });
        } else {
          resolve({ posts: [], error: "no posts found on the page (it may not have loaded)" });
        }
      } catch (e) {
        resolve({ posts: [], error: "scrape exception: " + ((e && e.message) || String(e)).slice(0, 200) });
      }
    }
  });
};
