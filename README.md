# OmniVault

Send yourself a note from your phone and find it on your laptop, without opening a browser tab that takes forty seconds and a gigabyte of memory to show you a chat you already regret using as a filing cabinet.

Notes, links, screenshots and tickers, kept in folders you choose. Every device holds its own complete copy in an ordinary SQLite database. When two of your devices are awake on the same Wi-Fi, they find each other and exchange what changed.

**What it will not do:** there is no server in between. A note written on your phone reaches your laptop the next time both are open on the same network — not before. If that is not a trade you want, this is the wrong tool, and it is better to know now than to discover it and think the app is broken.

Windows and Android. There is no iOS or macOS build. A phone or tablet can also reach the app through its own browser over your LAN, without installing anything.

---

## What it is actually for

The problem it was built for is small and specific, and it happens several times a day.

You are out. You do something worth writing down — you exit a position at a price, you read something you want to come back to, you photograph a page. It needs to reach the computer, in a form you can find again, with a few seconds of effort.

**The usual answer is to message yourself.** That works, and then it stops working. Opening a messaging app's web client on a laptop is a browser tab, a QR scan, a sync spinner and a large chunk of memory, and what arrives is one undifferentiated chronological stream. Five kinds of note — trades, links, ideas, receipts, things to look up — land in the same place and stay there. Finding one later means scrolling.

**OmniVault is that round trip without the detour.** Capture on the phone in the folder it belongs in. Come home. It is already on the laptop. Copy it out in one tap and paste it wherever it was going.

Privacy is a consequence of this design rather than the pitch for it: nothing leaves your network because nothing needs to. Read the threat model below before trusting that on a network you do not control.

### Where it sits next to other things

**Messaging yourself** wins on reach — it works from anywhere. It loses on structure, on speed to open, and on ever finding anything again.

**Cloud note apps** solve the structure and add an account, a login and a sync service between you and your own writing.

**File transfer tools** like AirDrop or LocalSend move a file to a device that is awake right now. Capture something on a walk with your laptop shut and there is nothing to transfer to. OmniVault keeps it locally and catches up when both ends are next online together.

The honest counterpoint: all of those work from anywhere on the internet. This one works when your devices are on the same network. That is the whole trade.
---

## How it is put together

```
React 18 + Vite + Tailwind  ──  one frontend, served two ways
        │                        (desktop WebView, and over LAN to a browser)
        ▼
Rust core (Tauri 2)
  ├── SQLite               nested folders, items, append-only revision log
  ├── Media                images converted to WebP, named by content hash,
  │                        stored as files — never as blobs in a table row
  ├── HTTP/1.1 server      hand-written, no framework, on 0.0.0.0:42420
  └── Mesh sync
        ├── discovery      UDP multicast on 239.255.42.99
        ├── pairing        6-digit PIN, read off the other device's screen
        ├── delta sync     revision log exchanged over plain HTTP
        └── conflicts      Last-Write-Wins, compared on each row's own clock
```

A few consequences of that shape worth knowing:

- **The sync engine has no network dependencies.** The HTTP client and server are written by hand rather than pulled from crates, because cross-compiling a TLS stack to Android was a bigger problem than writing HTTP/1.1.
- **Sync traffic is not encrypted.** See the threat model below before using this on a network you do not control.
- **Nothing phones home.** The only outbound request the app can make is the update check, and only when you press the button.

---

## What it does

**Folders, nested as deep as you like.** Create, rename, move and delete, with cycle protection so a folder cannot be moved inside itself.

**A capture bar that takes four things** — a note, a stock or crypto ticker, a link, or an image — into a Quick Inbox you triage later. Or never; leaving it in the inbox is a legitimate way to use it.

**A Markdown editor** with a formatting toolbar, live preview and debounced autosave. Ticker symbols and URLs found in your text become one-tap links out to TradingView, Yahoo Finance, or the site itself.

**Images.** Paste a screenshot with `Ctrl+V` on the desktop, or share one into the app from anywhere on Android. Stored as WebP, viewable in a zoomable lightbox.

**Drag and drop** from the inbox onto a folder, with subfolders opening as you hover.

**Backup and restore.** One zip holding your notes as plain Markdown, your images, and the database. Restore merges rather than overwrites — see below.

**Reachable from a browser.** A tablet or phone on the same LAN can open the app at `http://<your-lan-ip>:42420` and install it as a PWA, with no APK. This is off per device until you turn it on.

---

## Keyboard shortcuts

| Shortcut | Action | Where |
| :--- | :--- | :--- |
| `Ctrl + Enter` | Save the note or capture | Capture bar, editor |
| `Ctrl + B` / `Ctrl + I` | Bold / italic | Editor |
| `Ctrl + K` | Insert a Markdown link | Editor |
| `Ctrl + V` | Paste a screenshot | Anywhere outside the editor |
| `+` `-` `0` | Zoom in, out, reset | Image lightbox |
| `Esc` | Close whatever is open | Any modal |

---

## Getting it

Downloads are on the [releases page](https://github.com/webtools-dotcom/OmniVault/releases).

**Windows** — take `omnivault-v0.1.0-windows-x64.zip`, extract it anywhere, run `omnivault.exe`. There is no installer and nothing to add to your system. Windows will say the app is unrecognised, because the binary is not code-signed; the dialog hides "Run anyway" behind **More info**.

**Android** — take `omnivault-v0.1.0-android.apk` and open it on the device. Android will ask you to allow installs from whichever app you downloaded it with. One APK covers phones and tablets.

Neither is signed by a paid certificate authority, so both warn. That is the cost of not paying one, not a sign that something is wrong. If you would rather not trust a binary from the internet, the build steps below produce the same thing from source.

The app checks for newer releases only when you press **Check for updates** in the sidebar. It asks this repository's releases page once and nothing about your vault goes with the request.

### Or use it from a browser, with nothing installed

A phone or tablet on the same network can open the vault in its browser instead. On the computer, open **Connect device → Open in a browser**, turn on browser access, and scan the code. This is genuinely install-free, but it is a browser tab rather than an app — for daily capture the Android build is the better answer.

---

## Building it

### You will need

- Node.js 18+ and npm
- Rust 1.80+ with Cargo
- Windows 10/11 with WebView2, for the desktop build
- For Android: the Android SDK command-line tools, NDK 26+, and JDK 17+

### Run it

```bash
npm install
npm run dev          # frontend only, in a browser
npm run tauri dev    # the real desktop app
```

### Check it

```bash
npm test
```

Five stages, and it is the only gate this project has: TypeScript and a production frontend build; Rust compilation, unit tests and headless two-device sync simulations; structural, contrast and design-token assertions; a bundle smoke test; and release packaging with a SHA-256 integrity check across both platforms. It also refuses to package an Android APK signed with the wrong key, for the reason in "Updating" below.

### Build releases

```bash
npm run build:release && npm run package:windows
npm run build:android && npm run package:android
```

Both land in `release/` with checksums. Sizes are in the low single-digit megabytes each; the exact figures are on the release itself rather than written here, because numbers in a README go stale silently.

---

## Local HTTP API

The embedded server exposes a small JSON API on port `42420`. Every route under `/api/` requires a pairing token except `/api/health`, `/api/lan-info` and `/api/pair`.

| Method | Endpoint | What it is |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Liveness check. Public |
| `GET` | `/api/lan-info` | LAN address, port and the current pairing PIN. Public |
| `POST` | `/api/pair` | Exchanges a correct PIN for a device token. Public |
| `GET` | `/api/folders` | Every folder |
| `GET` | `/api/items` | Items, filtered with `?folder_id=<uuid>` |
| `GET` | `/api/media/<hash>` | An image blob |

---

## Security and privacy

### What OmniVault does

- **Zero cloud intermediaries.** Your data never touches a third-party server. There are no accounts, no telemetry, and no analytics.
- **Pairing is required.** Every `/api/*` route rejects callers that do not present a token issued by the 6-digit PIN handshake. The only exceptions are the health check, the LAN-info probe, and the pairing endpoint itself.
- **The PIN never crosses the network.** It is displayed only in the desktop app's own window and must be read off that screen, so possession of it is evidence of physical presence at the machine.
- **Same-origin browser access.** Responses carry no cross-origin grant unless the caller is the app itself, so a web page you happen to visit cannot read the vault through `localhost`.
- **SHA-256 integrity on media.** Every blob is verified against its content hash before it is written to disk; a corrupted or tampered transfer is discarded.

### Threat model — read this before using it on a network you do not trust

OmniVault is built for a **trusted home network**. It is explicitly not hardened for public or shared Wi-Fi, and the following are known, deliberate limitations rather than oversights:

- **Traffic is not encrypted in transit.** Sync runs as plain HTTP/1.1 over TCP on the local network. There is no TLS. Anyone able to observe traffic on your LAN — a compromised router, a hostile device on the same café or hotel Wi-Fi — can read your notes and images as they sync. Do not pair devices over a network you do not control.
- **The server binds all interfaces.** It listens on `0.0.0.0:42420`, not only loopback. On a machine with a public IP and no firewall, that port is reachable from outside your LAN.
- **Media URLs carry the token in the query string.** Images are loaded by `<img src>`, which cannot send headers, so the credential travels in the URL and will appear in any HTTP log or proxy along the path.
- **The pairing PIN is six digits.** It is drawn from a cryptographic random source, expires after 120 seconds, authorises exactly one device, and failed attempts are throttled to five per address per minute — so the 900,000-value space cannot be walked inside a window. Six digits is still six digits: it is a presence check, not a password.
- **Browser access is off until you turn it on.** Serving the web UI to a tablet browser is opt-in per device; while it is off, that device answers browser requests with 403 and only the sync API stays reachable.
- **Anything running on your computer is trusted.** Requests from loopback that carry the desktop app's own origin skip authentication. A malicious local program could use this — though it could equally read the SQLite file directly, so nothing additional is exposed.

If you want it reachable beyond your own LAN, put it behind a VPN or an SSH tunnel. Do not port-forward it.

---

## Updating

**Back up before you update.** Not as a ritual — for a specific reason.

Android identifies an app by the key it was signed with. If a release is ever signed with a different key than the one already on your device, Android will not install it over the top: you would have to uninstall first, **and uninstalling deletes the vault.** The project guards against that on its side — `npm test` refuses to package an APK signed with the wrong key — but a backup in your downloads folder is the thing that makes it survivable no matter what.

There is no automatic update check. The app makes no network requests at all unless you press **Check for updates** in the sidebar, which asks the releases page once and tells you what it found. Nothing about your vault goes with that request, nothing is remembered, and nothing checks in the background.

---

## Getting your notes back out

**Back up** in the sidebar writes the whole vault to a single `.zip` in your downloads folder. It holds three things:

- `notes/` — every note as plain Markdown, in the folders you filed it under. These need no app at all. Open them in any text editor, now or in twenty years.
- `media/` — the images, named by content hash. The Markdown links to them by relative path, so a Markdown viewer shows them in place.
- `omnivault.db` — the vault itself, an ordinary SQLite database, for an exact restore.

Nothing in the archive is encrypted. Anyone holding that file can read everything in it, so keep it where you would keep the notes themselves.

This exists because a vault you cannot get out of is a trap. If the app stops being maintained, or you stop trusting it, or the device dies, your writing should not go with it.

---

## License

OmniVault is licensed under the [MIT License](LICENSE).
