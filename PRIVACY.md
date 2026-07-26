# Privacy Policy — Cookie Vault

**Last updated: [DATE — fill in when you publish]**

## Summary

Cookie Vault does not collect, transmit, sell, or share any data,
anywhere, ever. Everything the extension does happens inside your own
browser, on your own device.

## What the extension does

Cookie Vault reads a cookie export file that you choose (a JSON file,
a Netscape-format `cookies.txt`, or a `.zip` containing either) and
writes the cookies it contains to your browser's cookie store, using
Chrome's built-in `cookies` API.

## What data it touches, and where it stays

| Data | Where it lives | Where it goes |
|---|---|---|
| The file you upload | Read directly by the extension's popup, in memory | Nowhere — never transmitted |
| Parsed cookie entries (name, value, domain, etc.) | `chrome.storage.local`, on your device only | Nowhere — never transmitted |
| The cookies themselves, once restored | Chrome's own cookie store (the same place any website's cookies live) | Wherever Chrome normally sends cookies — to the sites that own them, exactly as if you'd logged in normally |

There is no server component to this extension. There is nothing to
send data to, and no code path that sends any.

## Incognito windows

If you use Cookie Vault in an Incognito window, its stored data for
that session is kept separate from normal-window data and is
associated with the Incognito profile, which Chrome discards when the
Incognito window closes.

## Third-party sharing

None. There are no analytics, no error-reporting services, no
advertising SDKs, and no third-party libraries that communicate over
the network. The one bundled library (JSZip) runs entirely locally to
read `.zip` file contents and does not make network requests.

## Permissions

See the "Permissions, explained" section of the [store listing
description](./store-assets/store-listing.md) for what each requested
permission is used for and why.

## Changes to this policy

If this policy changes, the updated version will be posted at this
same location with a new "Last updated" date.

## Contact

[PLACEHOLDER — your email or a support alias]
