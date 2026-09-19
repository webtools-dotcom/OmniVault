# 🛡️ OmniVault

> **Private, Local-First, Cross-Device Knowledge Vault & Workspace**  
> *Infinite nested folders, instant multi-format capture, and asynchronous store-and-forward mesh synchronization over local Wi-Fi.*

---

## ⚡ Overview

**OmniVault** is a completely decentralized, private personal workspace built for researchers, traders, developers, and creators who work across multiple devices (Windows PC, laptop, iPhone, iPad, Android). 

Capture fleeting thoughts, stock charts, research notes, and web links instantly on any device — even completely offline. When your devices connect to the same local Wi-Fi network or mobile hotspot, they silently discover each other via mDNS and sync delta revisions in milliseconds over encrypted TCP streams.

### 🌟 Why OmniVault?

| Tool | The Problem | How OmniVault Solves It |
| :--- | :--- | :--- |
| **Messaging Apps** *(WhatsApp / Telegram "Saved Messages")* | Unsearchable chronological junk drawer, zero folder hierarchy, zero privacy from cloud operators. | **Deep folder nesting**, 📥 **Quick Inbox triage**, and **100% private local SQLite database**. |
| **Cloud Note Apps** *(Notion, Evernote, OneNote)* | Heavy bloat, cloud login barriers, slow capture speeds, and data hosted on third-party servers. | **Sub-second cold start**, **zero external cloud accounts**, and **pure local filesystem storage**. |
| **File Transfer Tools** *(LocalSend, AirDrop)* | Ephemeral and point-to-point only: if your laptop is asleep when you capture on your phone, transfer fails. | **Asynchronous Store-and-Forward Mesh**: captures queue locally and catch up automatically when online. |

---

## 🏛️ Architecture

OmniVault follows a strict **Pure Local Core** architecture:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Universal React Frontend                        │
│             (Vite + React 18 + Tailwind CSS + Lucide Icons)            │
│         Compiles to static assets: Desktop WebView & Mobile Web        │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
                 ┌───────────────────┴───────────────────┐
                 ▼                                       ▼
    ┌──────────────────────────┐            ┌──────────────────────────┐
    │     Desktop Tauri 2      │            │   Local HTTP / API       │
    │     IPC Invocation       │            │   Server (Port 42420)    │
    └────────────┬─────────────┘            └────────────┬─────────────┘
                 │                                       │
                 └───────────────────┬───────────────────┘
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         Pure Rust Backend Core                         │
│                                                                        │
│   ┌───────────────────────┐  ┌───────────────────┐  ┌──────────────┐  │
│   │     SQLite Engine     │  │  Media Processor  │  │ Local Server │  │
│   │  - Nested Folders     │  │  - WebP Conversion│  │ - Static SPA │  │
│   │  - Vault Items & Reus │  │  - Content Hashing│  │ - REST API   │  │
│   └───────────────────────┘  └───────────────────┘  └──────────────┘  │
│                                                                        │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │                     Local Mesh Sync Engine                      │  │
│   │  - mDNS / UDP Peer Discovery      - 6-Digit PIN Pairing         │  │
│   │  - Bidirectional TCP Delta Sync   - LWW Conflict Resolution     │  │
│   │  - Chunked Media Blob Streaming   - SHA-256 Tamper Detection    │  │
│   └─────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

1. **Pure Rust Core for Data & Networking:**
   - Transactional SQLite persistence (`rusqlite`) with infinite hierarchical folder nesting and revision logging.
   - Zero-dependency mDNS / UDP broadcast engine for decentralized peer discovery.
   - Asynchronous store-and-forward TCP delta sync with Last-Write-Wins (LWW) conflict resolution.
   - Chunked TCP media blob streaming with SHA-256 verification and session token authentication.
   - Embedded non-blocking HTTP/1.1 server running on `0.0.0.0:42420` for LAN browser and mobile PWA access.
2. **Single Universal Frontend (React + Tailwind):**
   - Single codebase running identically in Tauri desktop WebView and over mobile/tablet Safari and Chrome.
3. **Local Disk Blob Storage:**
   - Media attachments and screenshots are automatically converted into compressed WebP files and stored on the local disk. Never stored as binary blobs in SQLite rows.
4. **Zero External Cloud & Zero Telemetry:**
   - No external API requests, no tracking scripts, and no telemetry.

---

## ✨ Core Features

### 📁 Hierarchical Folder System
- Infinite nesting hierarchy (`Parent / Child / Subfolder`).
- Visual tree explorer with expand/collapse, item counts, and active selection states.
- Breadcrumb navigation for instantaneous workspace jumping.
- Modal operations for creating, renaming, moving (with ancestry cycle protection), and deleting folders.

### 📥 1-Tap Quick Inbox
- Instant multi-format capture bar supporting **Notes**, **Tickers**, and **Web Links**.
- Fast `Ctrl+Enter` persistence.
- High-contrast pinned items sorting and quick item deletion.

### 📝 Note & Idea Editor
- Split-pane Markdown editor with real-time formatting preview.
- Markdown toolbar for Bold, Italic, Code, Blockquotes, Bullets, and Checklists.
- 600ms debounced auto-save directly to local storage.
- Auto-detection and live highlight of financial symbols (`$NVDA`, `BTC`).

### 📈 Smart Ticker & Link Detector
- Scans unfiled thoughts and notes for stock and cryptocurrency symbols (`$NVDA`, `AAPL`, `BTC`, `ETH`).
- Generates interactive **Smart Market Launcher** pills with 1-click execution to both:
  - **TradingView** (`https://www.tradingview.com/symbols/...`)
  - **Yahoo Finance** (`https://finance.yahoo.com/quote/...`)
- Auto-detects URLs with clean domain indicator chips.

### 🖼️ Rich Media & Lightbox
- Global clipboard listener (`Ctrl+V`): paste screenshots directly from trading platforms or browsers.
- Local file picker with image aspect thumbnail preview.
- Dedicated high-resolution **Image Lightbox** with smooth 50%–400% zoom, drag panning, WebP download, and keyboard shortcuts (`+`, `-`, `0`, `Esc`).

### 🗂️ Drag-and-Drop & 1-Click Triage
- Native HTML5 drag-and-drop: drag inbox cards directly onto folder tree items.
- Auto-expand subfolders on 500ms drag hover.
- Enhanced 1-click triage modal with full hierarchical paths (`Research / Equities / AI`) and instant filing buttons.

### 📱 Local Zero-Install Web App & Mobile PWA
- Embedded HTTP server exposes the universal frontend over your local network (`http://<LAN-IP>:42420`).
- **QR Code Connection Modal:** Scan with your phone or tablet camera to connect immediately with zero app store installation.
- **W3C Standalone PWA:** Install to your mobile home screen with offline shell caching via Service Worker (`sw.js`).
- **Mobile Web Share Target:** Share links or text from Safari / Chrome directly into Quick Inbox via the system share sheet.
- **Touch Gestures:** Edge-swipe right to open the folder drawer; swipe left to close.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action | Scope |
| :--- | :--- | :--- |
| `Ctrl + Shift + I` | Navigate to Quick Inbox | Global |
| `Ctrl + Enter` | Save note / capture item | Capture Bar & Editor |
| `Ctrl + B` | Format **Bold** text | Note Editor |
| `Ctrl + I` | Format *Italic* text | Note Editor |
| `Ctrl + K` | Insert Markdown Link `[title](url)` | Note Editor |
| `Ctrl + V` | Paste screenshot / clipboard image | Global (outside editor) |
| `+` / `=` | Zoom In | Image Lightbox |
| `-` | Zoom Out | Image Lightbox |
| `0` | Reset Zoom to 100% | Image Lightbox |
| `Esc` | Dismiss modal / lightbox / editor | Any Modal |

---

## 🚀 Quick Start

### Windows Desktop (Standalone Release)

1. Download the latest release from [GitHub Releases](https://github.com/omnivault/omnivault/releases):
   - `omnivault-v0.1.0-windows-x64.zip` (Portable package, ~2.8 MB)
   - Or standalone `omnivault.exe` (~6.1 MB)
2. Extract and double-click `omnivault.exe`.
3. **No installer, no background services, and no cloud accounts required.**

### Native Android Application (Standalone Sideloading)

1. Download `omnivault-v0.1.0-android.apk` (~9.2 MB) from [GitHub Releases](https://github.com/omnivault/omnivault/releases).
2. On your Android phone or tablet, tap the downloaded APK to install. (If prompted, allow *"Install unknown apps"* for your browser or file manager).
3. **100% Offline Outdoor Capture:** Capture notes, links, ideas, and photos anywhere in the world with zero internet.
4. **Native Android Share Sheet (`ACTION_SEND`):** Highlight text or tap "Share" on any photo/link in Twitter, Reddit, Camera, Chrome, or Gallery, and select **OmniVault** to dump directly into your Quick Inbox.
5. **Automatic Store-and-Forward Mesh Sync:** When you return home and connect to your local Wi-Fi (or turn on a mobile hotspot), your phone and desktop discover each other automatically and silently sync all deltas in milliseconds!

### Connecting Mobile / Tablet via Local Browser (Zero-Install PWA)

1. Launch OmniVault on your Windows PC.
2. Click **"Connect Mobile"** in the top navigation bar or sidebar.
3. Scan the displayed **QR Code** using your phone or tablet camera (or open `http://<your-lan-ip>:42420` in your mobile browser).
4. Tap **"Add to Home Screen"** to install as a standalone PWA without installing any APK!

---

## 🛠️ Development & Building

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+) & `npm`
- [Rust](https://www.rust-lang.org/) (1.80+ with Cargo)
- Windows 10/11 with WebView2 (standard on modern Windows)
- For Android: Android SDK `cmdline-tools`, NDK 26+, and JDK 17+

### 1. Install Dependencies

```bash
npm install
```

### 2. Run Development Server

```bash
# Frontend development server
npm run dev

# Full Tauri desktop development window
npm run tauri dev
```

### 3. Run Automated Unified Verification

OmniVault includes a 5-stage unified test harness that verifies the entire stack:

```bash
npm test
```

This automatically runs:
1. Frontend TypeScript type checking & Vite production build (`tsc && vite build`).
2. Rust core compilation, unit tests, and headless multi-device sync simulations (`cargo test`).
3. Structural, WCAG AA contrast, and design token integrity assertions.
4. Production bundle HTTP smoke test.
5. Multi-platform release packaging and SHA-256 asset integrity check (Windows `.exe` + Android `.apk`).

### 4. Build Production Releases

#### Windows Standalone Release
```bash
# Compile optimized release binary with LTO and stripped symbols
npm run build:release

# Package portable release bundle, verify < 15MB budget, and generate SHA-256 checksums
npm run package:windows
```
The optimized standalone distribution is produced in `release/omnivault-v0.1.0-windows-x64/` (~6.13 MB).

#### Android Standalone Release APK
```bash
# Compile optimized release APK with ProGuard/R8 shrinking and release keystore signing
npm run build:android

# Package standalone APK to release/ and generate SHA-256 checksums
npm run package:android
```
The optimized standalone APK is staged in `release/omnivault-v0.1.0-android.apk` (~9.29 MB).

---

## 🌐 Local REST API Reference

When OmniVault runs, its embedded Rust HTTP server exposes lightweight JSON endpoints on port `42420` for LAN clients:

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Server status and uptime health check |
| `GET` | `/api/lan-info` | Active LAN IP address, port, and 6-digit peer PIN |
| `GET` | `/api/folders` | Complete JSON list of all nested folders |
| `GET` | `/api/items` | List of items (filter with `?folder_id=<uuid>` or unfiled) |
| `GET` | `/media/<filename>` | Fast binary streaming of local WebP media files |

---

## 🔒 Security & Privacy

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

## 📄 License

OmniVault is licensed under the [MIT License](LICENSE).
