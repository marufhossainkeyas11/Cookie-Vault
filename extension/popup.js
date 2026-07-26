// Cookie Vault — popup logic
// Import-only tool: read a cookie file (or a .zip of them), pick one, apply
// it to whichever domain it belongs to. Never depends on which tab is open.

// chrome.storage.local is shared between normal and incognito windows even
// with "incognito": "split" in the manifest — so a normal-mode scan and an
// incognito-mode scan are kept apart with two different storage keys, never
// the same key. Resolved once, right after we know which context we're in.
//
// Note: "split" mode is Chrome-only. Firefox doesn't support it and falls
// back to "spanning" (or refuses incognito access outright, depending on
// version) — on Firefox this key-suffix logic still runs, it just won't
// get a genuinely separate background context to go with it.
let STORAGE_KEY = "cookieVaultScan"; // placeholder until resolveStorageKey() runs

async function isIncognitoWindow() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return !!tab?.incognito;
  } catch {
    return false;
  }
}

async function resolveStorageKey() {
  const incognito = await isIncognitoWindow();
  STORAGE_KEY = incognito ? "cookieVaultScan_incognito" : "cookieVaultScan_normal";
  return incognito;
}

const state = {
  parsedEntries: [], // [{ path, domain, format, cookies, folder }]
  selectedIndex: -1,
  manualDomain: "",
  searchQuery: "",
  activeFolder: null, // null = showing top-level folder list; a string = drilled into that folder
  isIncognito: false,
};

// ---------- DOM utilities ----------

function $(sel) { return document.querySelector(sel); }
function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

function setStatus(el, text, kind) {
  el.textContent = text;
  el.className = "status" + (kind ? " " + kind : "");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function toBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.trim().toLowerCase() === "true";
  return !!v;
}

// ---------- Confirm dialog ----------
// One reusable modal for any "are you sure" moment (replacing the current
// file, removing it). Resolves true on Confirm, false on Cancel or Esc.

function showConfirm(title, body, confirmLabel) {
  const overlay = $("#confirmOverlay");
  const okBtn = $("#confirmOkBtn");
  const cancelBtn = $("#confirmCancelBtn");

  $("#confirmTitle").textContent = title;
  $("#confirmBody").textContent = body;
  okBtn.textContent = confirmLabel || "Confirm";
  overlay.classList.remove("hidden");
  okBtn.focus();

  return new Promise((resolve) => {
    function cleanup(result) {
      overlay.classList.add("hidden");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onOverlayClick);
      document.removeEventListener("keydown", onKeydown);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    function onOverlayClick(e) { if (e.target === overlay) cleanup(false); }
    function onKeydown(e) { if (e.key === "Escape") cleanup(false); }

    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    overlay.addEventListener("click", onOverlayClick);
    document.addEventListener("keydown", onKeydown);
  });
}

// ============================================================
// FORMAT READERS — auto-detected:
//   1. Netscape cookies.txt
//   2. Puppeteer / Playwright storageState JSON ({ cookies: [...] })
//   3. EditThisCookie / Cookie-Editor style JSON array
//   4. Raw "Cookie: a=1; b=2" header string (no domain info — asked later)
// ============================================================

function parseNetscape(text) {
  const cookies = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split("\t");
    if (parts.length < 7) continue;
    const [domain, , path, secure, expiry, name, value] = parts;
    if (!name) continue;
    cookies.push({
      domain,
      path: path || "/",
      secure: secure === "TRUE",
      expirationDate: Number(expiry) || undefined,
      session: Number(expiry) === 0,
      name,
      value: value ?? "",
    });
  }
  return cookies;
}

function normalizeJsonCookie(c) {
  if (!c || !c.name || !c.domain) return null;
  let expirationDate = c.expirationDate ?? c.expiry ?? c.expires;
  if (typeof expirationDate === "string") {
    const parsed = Date.parse(expirationDate);
    expirationDate = isNaN(parsed) ? undefined : parsed / 1000;
  }
  if (expirationDate === -1) expirationDate = undefined;

  let sameSite = c.sameSite;
  if (typeof sameSite === "string") {
    const s = sameSite.toLowerCase();
    if (s === "no_restriction" || s === "none") sameSite = "no_restriction";
    else if (s === "lax") sameSite = "lax";
    else if (s === "strict") sameSite = "strict";
    else sameSite = undefined;
  } else {
    sameSite = undefined;
  }

  return {
    name: c.name,
    value: c.value ?? "",
    domain: c.domain,
    path: c.path || "/",
    secure: toBool(c.secure),
    httpOnly: toBool(c.httpOnly ?? c.httponly),
    sameSite,
    expirationDate,
    session: c.session ?? (expirationDate === undefined),
  };
}

function parseJsonCookies(text) {
  let data;
  try { data = JSON.parse(text); } catch { return null; }

  if (data && Array.isArray(data.cookies)) {
    const out = data.cookies.map(normalizeJsonCookie).filter(Boolean);
    return out.length ? out : null;
  }
  if (Array.isArray(data)) {
    const out = data.map(normalizeJsonCookie).filter(Boolean);
    return out.length ? out : null;
  }
  return null;
}

// Raw "Cookie: a=1; b=2" or bare "a=1; b=2" header string.
// No domain info exists in this format — left null, resolved later in the UI.
function parseHeaderString(text) {
  const trimmed = text.trim();
  const body = trimmed.replace(/^cookie:\s*/i, "");
  if (!body || !body.includes("=") || body.includes("\n")) return null;

  const pairs = body.split(";").map(s => s.trim()).filter(Boolean);
  const cookies = [];
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!name) continue;
    cookies.push({ name, value, domain: null, path: "/", secure: false, httpOnly: false, session: true });
  }
  return cookies.length ? cookies : null;
}

function detectAndParse(text, filename) {
  const lower = filename.toLowerCase();

  if (lower.endsWith(".json")) {
    const c = parseJsonCookies(text);
    if (c) return { cookies: c, format: "json" };
  }

  const netscape = parseNetscape(text);
  if (netscape.length) return { cookies: netscape, format: "netscape" };

  const json = parseJsonCookies(text);
  if (json) return { cookies: json, format: "json" };

  const header = parseHeaderString(text);
  if (header) return { cookies: header, format: "header" };

  return null;
}

// Returns null (not a placeholder string) when no domain could be determined,
// so the UI can prompt for one instead of silently guessing wrong.
function guessDomainFromCookies(cookies) {
  const counts = {};
  for (const c of cookies) {
    const d = (c.domain || "").replace(/^\./, "");
    if (!d) continue;
    counts[d] = (counts[d] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted.length ? sorted[0][0] : null;
}

function splitPath(fullPath) {
  const idx = fullPath.lastIndexOf("/");
  if (idx === -1) return { folder: "", name: fullPath };
  return { folder: fullPath.slice(0, idx), name: fullPath.slice(idx + 1) };
}

// ============================================================
// PERSISTENCE — survives popup close, reload, and browser restart.
// Stays until the user confirms replacing it with a new file (see
// onFileChosen) or removes it explicitly (see the Clear button below).
// A successful restore does NOT clear it — restoring is not the same
// as removing, and the user may want to restore the same file again.
// ============================================================

async function saveScanToStorage() {
  try {
    await chrome.storage.local.set({
      [STORAGE_KEY]: {
        parsedEntries: state.parsedEntries,
        selectedIndex: state.selectedIndex,
        manualDomain: state.manualDomain,
        activeFolder: state.activeFolder,
      },
    });
  } catch {
    // Non-fatal — worst case the user re-picks the file.
  }
}

async function clearScanStorage() {
  try { await chrome.storage.local.remove(STORAGE_KEY); } catch {}
}

async function restoreScanFromStorage() {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const saved = data?.[STORAGE_KEY];
    if (!saved || !Array.isArray(saved.parsedEntries) || !saved.parsedEntries.length) return false;

    state.parsedEntries = saved.parsedEntries;
    state.selectedIndex = typeof saved.selectedIndex === "number" ? saved.selectedIndex : -1;
    state.manualDomain = saved.manualDomain || "";
    state.activeFolder = typeof saved.activeFolder === "string" ? saved.activeFolder : null;

    renderFileList();
    updateDomainPrompt();
    updateRestoreButton();
    const count = state.parsedEntries.length;
    setStatus($("#scanStatus"), `Restored ${count} file${count === 1 ? "" : "s"} from last time.`, "info");
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// INIT
// ============================================================

async function init() {
  state.isIncognito = await resolveStorageKey();
  if (state.isIncognito) {
    $("#incognitoBadge").classList.remove("hidden");
  }
  await restoreScanFromStorage();
}

// ---------- File input (zip OR single txt/json) ----------
// The <label class="dropzone"> already forwards clicks to its inner
// <input type="file"> natively — that's what a <label for-child-input>
// does in HTML. No extra click() call here, or the picker opens twice.

const dropzone = $("#dropzone");
const fileInput = $("#fileInput");

dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("drag-over"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag-over"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (file) onFileChosen(file);
});
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) onFileChosen(fileInput.files[0]);
  // Reset so choosing the exact same file again still fires "change".
  fileInput.value = "";
});

// Entry point for both drag-drop and the file picker. If a file is already
// loaded, this confirms with the user before replacing it — no silent
// overwrite. Runs the parse straight away only when there's nothing to lose.
async function onFileChosen(file) {
  if (state.parsedEntries.length > 0) {
    const count = state.parsedEntries.length;
    const ok = await showConfirm(
      "Replace the current file?",
      `You currently have ${count} cookie file${count === 1 ? "" : "s"} loaded. Choosing a new file will replace ${count === 1 ? "it" : "them"}.`,
      "Replace"
    );
    if (!ok) return;
  }
  await processFile(file);
}

async function processFile(file) {
  const scanStatus = $("#scanStatus");
  $("#fileListWrap").classList.add("hidden");
  $("#domainPrompt").classList.add("hidden");
  $("#restoreBtn").classList.add("hidden");
  $("#restoreActions").innerHTML = "";
  setStatus($("#restoreStatus"), "", "");
  $("#searchInput").value = "";
  state.parsedEntries = [];
  state.selectedIndex = -1;
  state.manualDomain = "";
  state.searchQuery = "";
  state.activeFolder = null;

  const lower = file.name.toLowerCase();

  try {
    if (lower.endsWith(".zip")) {
      await scanZip(file, scanStatus);
    } else if (lower.endsWith(".txt") || lower.endsWith(".json")) {
      await scanSingleFile(file, scanStatus);
    } else {
      setStatus(scanStatus, "Unsupported file type. Use .zip, .txt, or .json.", "err");
      return;
    }
  } catch (err) {
    setStatus(scanStatus, "Couldn't read the file: " + err.message, "err");
    return;
  }

  finalizeEntries(scanStatus);
  await saveScanToStorage();
}

async function scanSingleFile(file, scanStatus) {
  setStatus(scanStatus, "Reading file…", "info");
  const text = await file.text();
  const result = detectAndParse(text, file.name);
  if (!result) {
    setStatus(scanStatus, "No recognizable cookie data in this file.", "err");
    return;
  }
  state.parsedEntries.push({
    path: file.name,
    folder: "",
    name: file.name,
    domain: guessDomainFromCookies(result.cookies),
    format: result.format,
    cookies: result.cookies,
  });
}

async function scanZip(file, scanStatus) {
  setStatus(scanStatus, "Scanning archive…", "info");
  const zip = await JSZip.loadAsync(file);

  const candidates = [];
  zip.forEach((relPath, entry) => {
    if (entry.dir) return;
    const lower = relPath.toLowerCase();
    if (lower.endsWith(".txt") || lower.endsWith(".json")) candidates.push(entry);
  });

  if (!candidates.length) {
    setStatus(scanStatus, "No .txt or .json files found inside the archive.", "err");
    return;
  }

  setStatus(scanStatus, `Parsing ${candidates.length} file${candidates.length === 1 ? "" : "s"}…`, "info");

  for (const entry of candidates) {
    const text = await entry.async("string");
    const result = detectAndParse(text, entry.name);
    if (result) {
      const { folder, name } = splitPath(entry.name);
      state.parsedEntries.push({
        path: entry.name,
        folder,
        name,
        domain: guessDomainFromCookies(result.cookies),
        format: result.format,
        cookies: result.cookies,
      });
    }
  }
}

// Exactly one valid file -> select it (nothing else to choose from).
// Multiple files -> nothing is pre-selected; the user picks.
function finalizeEntries(scanStatus) {
  if (!state.parsedEntries.length) {
    setStatus(scanStatus, "Found files, but none contained valid cookie data.", "err");
    return;
  }

  if (state.parsedEntries.length === 1) {
    state.selectedIndex = 0;
  }

  renderFileList();
  updateDomainPrompt();
  updateRestoreButton();
  const count = state.parsedEntries.length;
  setStatus(scanStatus, `Found ${count} cookie file${count === 1 ? "" : "s"}.`, "ok");
}

// ---------- Search ----------
// Unchanged behavior: typing here always filters across every file,
// regardless of which folder (if any) is currently open.

$("#searchInput").addEventListener("input", (e) => {
  state.searchQuery = e.target.value.trim().toLowerCase();
  renderFileList();
});

function matchesSearch(entry) {
  if (!state.searchQuery) return true;
  const haystack = `${entry.domain || ""} ${entry.path}`.toLowerCase();
  return haystack.includes(state.searchQuery);
}

// ---------- Rendering ----------
// Two ways to get to a file, side by side:
//   1. Search box — filters everything flat, ignores folders entirely.
//   2. Folder browsing — when search is empty, folders are collapsed
//      buttons; clicking one drills in to show just its files, with a
//      Back control to return. Root-level files (no folder) always show.
// Search takes over whenever there's a query, same as before.

function folderIconSvg() {
  return `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
  </svg>`;
}

function backArrowSvg() {
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M19 12H5M11 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function groupByFolder(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.entry.folder || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function renderFileList() {
  const listWrap = $("#fileListWrap");
  const listEl = $("#fileList");
  const countBadge = $("#foundCountBadge");
  const titleEl = $("#fileListTitle");

  const indexed = state.parsedEntries.map((entry, idx) => ({ entry, idx }));
  countBadge.textContent = state.parsedEntries.length;
  listEl.innerHTML = "";

  // Searching always wins — flat results across every folder, same as
  // before drill-in existed.
  if (state.searchQuery) {
    const visible = indexed.filter(({ entry }) => matchesSearch(entry));
    titleEl.textContent = `${visible.length} of ${state.parsedEntries.length} match`;

    if (!visible.length) {
      listEl.innerHTML = `<div class="no-results">No files match "${escapeHtml(state.searchQuery)}".</div>`;
    } else {
      for (const [folder, items] of groupByFolder(visible).entries()) {
        listEl.appendChild(renderStaticGroup(folder, items));
      }
    }
    listWrap.classList.remove("hidden");
    return;
  }

  // No search query: either browsing folders at the top level, or
  // drilled into one specific folder.
  if (state.activeFolder !== null) {
    const items = indexed.filter(({ entry }) => (entry.folder || "") === state.activeFolder);
    titleEl.textContent = state.activeFolder;
    listEl.appendChild(renderBackHeader());
    for (const { entry, idx } of items) {
      listEl.appendChild(renderFileItem(entry, idx));
    }
    listWrap.classList.remove("hidden");
    return;
  }

  titleEl.textContent = "Files found";

  // Root level: files with no folder show directly; files inside a
  // folder are collapsed behind a clickable folder button.
  const rootItems = indexed.filter(({ entry }) => !entry.folder);
  const folderNames = [...new Set(indexed.filter(({ entry }) => entry.folder).map(({ entry }) => entry.folder))];

  for (const folder of folderNames) {
    const count = indexed.filter(({ entry }) => entry.folder === folder).length;
    listEl.appendChild(renderFolderButton(folder, count));
  }
  for (const { entry, idx } of rootItems) {
    listEl.appendChild(renderFileItem(entry, idx));
  }

  listWrap.classList.remove("hidden");
}

// Used only inside search results, where folders are shown as labeled
// groups (not clickable) since the user is already filtering.
function renderStaticGroup(folder, items) {
  const groupEl = document.createElement("div");
  groupEl.className = "file-group";

  if (folder) {
    const header = document.createElement("div");
    header.className = "file-group-header";
    header.innerHTML = `${folderIconSvg()}<span>${escapeHtml(folder)}</span>`;
    groupEl.appendChild(header);
  }

  for (const { entry, idx } of items) {
    groupEl.appendChild(renderFileItem(entry, idx));
  }
  return groupEl;
}

function renderFolderButton(folder, count) {
  const btn = document.createElement("div");
  btn.className = "folder-button";
  btn.innerHTML = `
    ${folderIconSvg()}
    <span class="folder-button-name">${escapeHtml(folder)}</span>
    <span class="folder-button-count">${count}</span>
  `;
  btn.addEventListener("click", () => openFolder(folder));
  return btn;
}

function renderBackHeader() {
  const header = document.createElement("div");
  header.className = "folder-back";
  header.innerHTML = `${backArrowSvg()}<span>All folders</span>`;
  header.addEventListener("click", () => openFolder(null));
  return header;
}

async function openFolder(folder) {
  state.activeFolder = folder;
  renderFileList();
  await saveScanToStorage();
}

function renderFileItem(entry, idx) {
  const item = document.createElement("div");
  item.className = "file-item" + (state.selectedIndex === idx ? " checked" : "");

  const domainHtml = entry.domain
    ? `<div class="file-item-domain">${escapeHtml(entry.domain)}</div>`
    : `<div class="file-item-domain unknown">domain unknown</div>`;

  item.innerHTML = `
    <div class="radio-dot"></div>
    <div class="file-item-meta">
      <div class="file-item-name">${escapeHtml(entry.name)}</div>
      ${domainHtml}
    </div>
    <span class="file-item-count">${entry.cookies.length}</span>
    <span class="file-item-format">${entry.format}</span>
  `;

  item.addEventListener("click", () => selectEntry(idx));
  return item;
}

async function selectEntry(idx) {
  state.selectedIndex = idx;
  state.manualDomain = "";
  $("#manualDomainInput").value = "";
  renderFileList();
  updateDomainPrompt();
  updateRestoreButton();
  await saveScanToStorage();
}

function updateDomainPrompt() {
  const prompt = $("#domainPrompt");
  const entry = state.parsedEntries[state.selectedIndex];
  const show = entry && !entry.domain;
  prompt.classList.toggle("hidden", !show);
  prompt.classList.remove("needs-attention");
}

$("#manualDomainInput").addEventListener("input", (e) => {
  state.manualDomain = e.target.value.trim();
  $("#domainPrompt").classList.remove("needs-attention");
  updateRestoreButton();
});

function updateRestoreButton() {
  $("#restoreBtn").classList.toggle("hidden", state.selectedIndex === -1);
}

function resolvedDomain(entry) {
  const d = entry.domain || state.manualDomain || "";
  return d.replace(/^\./, "").trim();
}

// ---------- Applying the selected file ----------
// Each cookie is set against the domain it belongs to (from the file, or a
// domain the user typed in) — never forced onto whatever tab is open.

$("#restoreBtn").addEventListener("click", async () => {
  const statusEl = $("#restoreStatus");
  const actionsEl = $("#restoreActions");
  actionsEl.innerHTML = "";

  const entry = state.parsedEntries[state.selectedIndex];
  if (!entry) return;

  if (!resolvedDomain(entry)) {
    $("#domainPrompt").classList.add("needs-attention");
    setStatus(statusEl, "Type a domain before restoring.", "err");
    return;
  }

  setStatus(statusEl, "Restoring…", "info");

  let success = 0, failed = 0;
  const errors = [];
  const touchedDomains = new Set();
  const nowSec = Date.now() / 1000;
  const entryDomain = resolvedDomain(entry);

  for (const c of entry.cookies) {
    const domain = (c.domain ? c.domain.replace(/^\./, "") : entryDomain);
    if (!domain) { failed++; errors.push(`${c.name}: no domain`); continue; }

    let secure = toBool(c.secure);
    let sameSite = c.sameSite;
    // Chrome rejects SameSite=None cookies unless Secure is also set.
    if (sameSite === "no_restriction") secure = true;

    const proto = secure ? "https" : "http";
    const path = c.path && c.path.startsWith("/") ? c.path : "/";

    const details = {
      url: `${proto}://${domain}${path}`,
      name: c.name,
      value: c.value ?? "",
      path,
      secure,
      httpOnly: toBool(c.httpOnly),
    };

    // Preserve domain-wide cookies (leading dot in the original export);
    // otherwise omit `domain` so Chrome creates a host-only cookie that
    // matches the URL exactly, same as the source.
    if (c.domain && c.domain.startsWith(".")) {
      details.domain = c.domain;
    }

    // A cookie whose expiry is already in the past won't actually persist —
    // restore it as a session cookie instead of letting it silently fail.
    let expirationDate = c.expirationDate;
    if (expirationDate && expirationDate <= nowSec) expirationDate = undefined;
    if (!c.session && expirationDate) details.expirationDate = Number(expirationDate);

    if (sameSite && ["no_restriction", "lax", "strict"].includes(sameSite)) {
      details.sameSite = sameSite;
    }

    const res = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: "SET_COOKIE", details }, resolve);
    });

    if (res?.ok) {
      success++;
      touchedDomains.add(domain);
    } else {
      failed++;
      errors.push(`${c.name}@${domain}: ${res?.error || "unknown error"}`);
    }
  }

  if (success && !failed) {
    setStatus(statusEl, `Restored ${success} cookie${success === 1 ? "" : "s"}.`, "ok");
  } else if (success && failed) {
    setStatus(statusEl, `${success} restored, ${failed} failed.`, "info");
  } else {
    setStatus(statusEl, `Nothing could be restored.`, "err");
  }

  if (errors.length) {
    const detail = document.createElement("div");
    detail.className = "error-detail";
    detail.textContent = errors.slice(0, 3).join(" · ") + (errors.length > 3 ? ` · +${errors.length - 3} more` : "");
    statusEl.appendChild(detail);
  }

  // Best-effort: find tabs already open on a restored domain and reload
  // them; otherwise offer a one-click way to open the site.
  for (const domain of touchedDomains) {
    const found = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: "FIND_TABS_FOR_DOMAIN", domain }, resolve);
    });
    const tabIds = found?.tabIds || [];

    if (tabIds.length) {
      chrome.runtime.sendMessage({ type: "RELOAD_TABS", tabIds });
      const note = document.createElement("button");
      note.className = "action-link";
      note.textContent = `Reloaded ${tabIds.length} open tab${tabIds.length === 1 ? "" : "s"} on ${domain}`;
      note.disabled = true;
      actionsEl.appendChild(note);
    } else {
      const btn = document.createElement("button");
      btn.className = "action-link";
      btn.textContent = `Open ${domain} →`;
      btn.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "OPEN_DOMAIN", domain });
      });
      actionsEl.appendChild(btn);
    }
  }
});

// ---------- Clear button ----------
// Removes the current upload entirely — from storage and from the UI —
// so the user always has an explicit way to remove a file, not just the
// implicit clear-on-successful-restore path that used to exist here.

$("#clearScanBtn").addEventListener("click", async () => {
  const count = state.parsedEntries.length;
  if (!count) return;

  const ok = await showConfirm(
    "Remove this file?",
    `This removes ${count} cookie file${count === 1 ? "" : "s"} from Cookie Vault. This can't be undone — you'll need to upload it again to restore from it.`,
    "Remove"
  );
  if (!ok) return;

  await clearScanStorage();

  state.parsedEntries = [];
  state.selectedIndex = -1;
  state.manualDomain = "";
  state.searchQuery = "";
  state.activeFolder = null;

  $("#fileListWrap").classList.add("hidden");
  $("#domainPrompt").classList.add("hidden");
  $("#restoreBtn").classList.add("hidden");
  $("#restoreActions").innerHTML = "";
  $("#searchInput").value = "";
  setStatus($("#restoreStatus"), "", "");
  setStatus($("#scanStatus"), "File removed.", "info");
});

init();
