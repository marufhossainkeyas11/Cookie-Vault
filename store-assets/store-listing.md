# Chrome Web Store — Listing Copy

Copy-paste reference for the Chrome Web Store Developer Dashboard listing
fields. Fill in the [PLACEHOLDER] values before submitting.

---

## Extension name
Cookie Vault

## Summary (max 132 characters — shown in search results)
Restore cookies from a JSON, cookies.txt, or ZIP file. Runs entirely on your device — nothing is ever uploaded.

## Category
Productivity (alternative: Developer Tools)

## Detailed description

Cookie Vault restores browser cookies from a file you already have — a
JSON export, a Netscape-format cookies.txt, or a ZIP containing several
of either. Everything happens locally in your browser. No account, no
server, no data collection.

**What it does**
- Reads a single cookie file, or scans a ZIP archive for every cookie
  file inside it, however deep the folder structure goes
- Auto-detects the format: JSON (Puppeteer/Playwright storageState
  style, EditThisCookie/Cookie-Editor style arrays), Netscape
  cookies.txt, or a raw `Cookie:` header string
- Lets you browse ZIP contents by folder, or search across all of them
  by domain or filename
- Restores the selected file's cookies to the domain it belongs to,
  and offers to reload any open tab on that domain
- Keeps your uploaded file on hand until you remove it yourself — no
  losing your work to an accidental popup close or browser restart
- Treats Incognito windows as a fully separate space: files you load
  there never appear in normal browsing, and vanish when the
  Incognito window closes

**What it does not do**
- It does not create or export cookie backups — it's an import/restore
  tool only
- It does not send anything anywhere. There is no backend. Every
  operation — reading your file, matching it to a domain, writing the
  cookie — happens inside the extension's own popup and background
  script, using Chrome's own cookie API

**Who it's for**
Anyone who exports cookies from one place (a script, another browser
profile, a teammate) and needs to load them into Chrome without typing
each one in by hand.

**Permissions, explained**
- `cookies` — required to read and write cookies via Chrome's cookies
  API; this is the extension's core function
- `tabs` — used only to find tabs already open on a domain you just
  restored cookies for, so it can offer to reload them, and to detect
  whether the popup is running in an Incognito window (needed to keep
  Incognito data separate)
- `storage` — used only to keep your uploaded file's parsed contents
  available between popup opens, entirely on your device
- Host permission (all sites) — cookies belong to whatever domain your
  file specifies, which isn't known in advance; this permission is
  what lets the extension write a cookie to that domain when you
  restore it. It is not used to read page content, inject scripts, or
  track browsing

---

## Privacy practices disclosure (Chrome Web Store Developer Dashboard)

When filling out the "Privacy practices" tab, the accurate answers are:

- **Does this item collect or transmit user data?** No.
- **Single purpose**: "Restores browser cookies from a locally-provided
  file (JSON, Netscape/cookies.txt, or ZIP)."
- Justification text for each permission: use the "Permissions,
  explained" section above, condensed to fit each field's character
  limit.

## Where to link the privacy policy
Chrome Web Store requires a privacy policy URL even for extensions
that collect nothing — host `PRIVACY.md` (in this repo) somewhere
public, e.g. as a GitHub Pages page or raw file link, and paste that
URL into the "Privacy policy" field on the dashboard.

---

## Support email
[PLACEHOLDER — your email or a support alias]

## Website / homepage
[PLACEHOLDER — your GitHub repo URL once created]
