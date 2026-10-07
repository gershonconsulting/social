// Personal LinkedIn profiles (extension 0.13.3).
//
// Some companies are tracked through a PERSON's LinkedIn page, not the company
// page — WALLIX publishes on its CEO's own profile
// (linkedin.com/in/jndegalzain-…). sync-core.js always builds the address
// linkedin.com/company/<vanity>/posts/, which for an /in/ link is a page that
// does not exist, so those companies came back "not collected" every day.
//
// This file remembers which tracked links are /in/ profiles (from the
// /api/extension/clients answer) and, when the collector points its tab at
// /company/<that vanity>/posts/, sends it to /in/<vanity>/recent-activity/all/
// instead — the profile's list of posts. The page reader (gx-linkedin.js)
// reads both layouts. Loaded by gx-boot.js after gx-collect.js.

(function () {
  var personal = {};

  var prevFetch = self.fetch.bind(self);
  self.fetch = async function (input, init) {
    var res = await prevFetch(input, init);
    try {
      var u = typeof input === "string" ? input : (input && input.url) || "";
      if (/\/api\/extension\/clients(\?|$)/.test(u) && res && res.ok) {
        var j = await res.clone().json();
        var list = (j && j.data && j.data.clients) || [];
        var next = {};
        for (var i = 0; i < list.length; i++) {
          var li = list[i] && list[i].linkedin;
          if (li && li.vanity && /linkedin\.com\/in\//i.test(li.url || "")) {
            next[String(li.vanity).toLowerCase()] = true;
          }
        }
        personal = next;
      }
    } catch (e) {}
    return res;
  };

  function rewrite(url) {
    var m = String(url || "").match(/^https:\/\/www\.linkedin\.com\/company\/([^/?#]+)\/posts\//);
    if (!m) return url;
    var v = decodeURIComponent(m[1]);
    if (!personal[v.toLowerCase()]) return url;
    return "https://www.linkedin.com/in/" + encodeURIComponent(v) + "/recent-activity/all/";
  }

  var prevUpdate = chrome.tabs.update.bind(chrome.tabs);
  chrome.tabs.update = function (tabId, props) {
    try {
      if (props && props.url) props = Object.assign({}, props, { url: rewrite(props.url) });
    } catch (e) {}
    return prevUpdate(tabId, props);
  };

  var prevCreate = chrome.tabs.create.bind(chrome.tabs);
  chrome.tabs.create = function (props) {
    try {
      if (props && props.url) props = Object.assign({}, props, { url: rewrite(props.url) });
    } catch (e) {}
    return prevCreate(props);
  };
})();
