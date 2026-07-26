# Changelog

All notable changes to Cookie Vault are documented here.

## [1.5.0] — Commercial readiness pass

### Changed
- Upload flow now asks for confirmation before replacing a file that's
  already loaded, instead of silently overwriting it.
- Restoring cookies no longer removes the loaded file automatically —
  it stays until you explicitly remove it, so you can restore the
  same file more than once if needed.
- The "remove file" action now shows a proper confirm dialog instead
  of a double-click-to-confirm button.
- Full visual redesign: replaced the generic dark-teal palette with a
  warm-charcoal, brass-accented "vault" theme; new lock-icon toolbar
  icon and in-popup brand mark to match.
- `manifest.json` description tightened to a single-purpose statement
  for store review.

### Fixed
- Two leftover hardcoded colors from the previous palette that hadn't
  been converted to the new design tokens.

## [1.4.0] — Incognito isolation

### Added
- `"incognito": "split"` in the manifest, so Chrome runs a separate
  background worker for Incognito windows.
- Context-aware storage keys so a normal-mode scan and an
  Incognito-mode scan never share data, even though
  `chrome.storage.local` itself is shared across both contexts.
- An in-popup badge indicating when you're in an Incognito window.

### Fixed
- A manual "remove upload" control was missing entirely — added an
  explicit clear action so an uploaded file could actually be removed
  before this version's later confirm-dialog refinement.

## [1.3.0] — Folder browsing and persistence

### Added
- Folder drill-in navigation for `.zip` scans: browse by folder, or
  search across everything regardless of folder.
- Scan results now persist across popup close and browser restart via
  `chrome.storage.local` (previously `chrome.storage.session`, which
  cleared on browser close).

## [1.2.0] and earlier

- Initial cookie-restore functionality: JSON, Netscape `cookies.txt`,
  and raw header-string parsing; `.zip` scanning; single-select
  restore flow; original "Cookie Vault — Backup & Restore" naming
  before the backup/export feature was removed to focus the tool on
  import/restore only.
