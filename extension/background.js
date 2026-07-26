// Cookie Vault — background service worker
// Reads/writes cookies via the chrome.cookies API and handles tab lookups
// for the popup's restore flow. Never assumes a specific tab is open.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GET_COOKIES_FOR_URL") {
    chrome.cookies.getAll({ url: msg.url }, (cookies) => {
      sendResponse({ cookies });
    });
    return true;
  }

  if (msg.type === "SET_COOKIE") {
    chrome.cookies.set(msg.details, (cookie) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      } else if (!cookie) {
        sendResponse({ ok: false, error: "rejected by browser (check SameSite/Secure/domain)" });
      } else {
        sendResponse({ ok: true });
      }
    });
    return true;
  }

  // Finds any open tabs whose host matches (or is a subdomain of) the given
  // domain. Filtering happens here rather than via tabs.query's url pattern
  // because the domain is only known at runtime (from the imported file) —
  // matching both the bare domain and its subdomains via query-time patterns
  // would need two dynamically-built patterns per lookup; comparing hostnames
  // directly is simpler and just as precise.
  if (msg.type === "FIND_TABS_FOR_DOMAIN") {
    const domain = (msg.domain || "").toLowerCase();
    chrome.tabs.query({}, (tabs) => {
      const matches = (tabs || []).filter((t) => {
        if (!t.url) return false;
        try {
          const host = new URL(t.url).hostname.toLowerCase();
          return host === domain || host.endsWith("." + domain);
        } catch {
          return false;
        }
      });
      sendResponse({ tabIds: matches.map((t) => t.id) });
    });
    return true;
  }

  if (msg.type === "RELOAD_TABS") {
    (msg.tabIds || []).forEach((id) => chrome.tabs.reload(id));
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "OPEN_DOMAIN") {
    chrome.tabs.create({ url: `https://${msg.domain}/` });
    sendResponse({ ok: true });
    return true;
  }
});
