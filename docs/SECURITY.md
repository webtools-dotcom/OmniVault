# Security

OmniVault is built for a network you trust — your home Wi-Fi, or your own
phone's hotspot. This page states what it protects against and, as plainly,
what it does not.

## What it does

- **No cloud, no accounts, no telemetry.** Nothing leaves the local network.
  The only outbound request the app can make is the update check, and only
  when _Check for updates_ is pressed.
- **Every API route requires pairing.** `/api/*` rejects callers without a
  device token, except `/api/health`, `/api/lan-info` and the two pairing
  routes.
- **Pairing needs someone at the other device.** A native app is let in only
  when a person presses _Allow_ on the device being joined. A browser must type
  a PIN that is shown only on the desktop and never sent over the network. PINs
  come from a cryptographic source, expire after 120 seconds and authorise one
  device.
- **Pairing is rate-limited.** Five attempts or requests per address per minute,
  and only one approval prompt can be pending at a time.
- **Same-origin only.** Responses carry no cross-origin grant except to the app
  itself, so a web page cannot read the vault through `localhost`.
- **Stored files cannot run as the app.** Media is served with
  `Content-Security-Policy: sandbox` and `X-Content-Type-Options: nosniff`, so
  an HTML or SVG file kept in the vault cannot reach the app's storage.
- **Transfers are verified.** Every media blob is checked against its SHA-256
  before it is written to disk.
- **Links are filtered.** Links rendered from note content are limited to
  `http`, `https` and `mailto`.

## Threat model

These are known, deliberate limitations:

- **Traffic is not encrypted.** Sync is plain HTTP/1.1 over TCP. Anyone who can
  observe your LAN can read notes and files as they sync. Do not pair devices on
  a network you do not control.
- **The server listens on all interfaces** (`0.0.0.0:42420`). On a machine with
  a public address and no firewall, that port is reachable from outside the LAN.
- **Media URLs carry the token in the query string**, because `<img src>` cannot
  send headers. It will appear in any log or proxy on the path.
- **A PIN is six digits.** With expiry and throttling it cannot be brute-forced
  in its window, but it is a presence check, not a password.
- **Local programs are trusted.** Loopback requests carrying the desktop app's
  own origin skip authentication. A malicious local program could equally read
  the SQLite file directly.
- **Backups are not encrypted.** Keep the archive wherever you would keep the
  notes themselves.

To reach the vault from outside your LAN, use a VPN or an SSH tunnel. Do not
port-forward it.

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository rather than a
public issue.
