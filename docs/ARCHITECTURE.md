# Architecture

OmniVault is a Tauri 2 application: a Rust core that owns all data and
networking, and a single React frontend that runs both inside the desktop and
Android WebViews and, over the LAN, in any browser.

```
src/                    React 18 + TypeScript + Tailwind (one UI for every surface)
src-tauri/src/
  lib.rs                app start-up, Tauri commands, background workers
  http_server.rs        embedded HTTP/1.1 server on 0.0.0.0:42420
  db/
    schema.rs           SQLite schema and migrations
    storage.rs          folders, items, revision log
    media.rs            content-addressed blob storage
    export.rs import.rs backup archive (zip) writer and merging restore
  sync/
    discovery.rs        UDP peer discovery on port 42424
    pairing.rs          paired-device store
    protocol.rs         revision exchange and Last-Write-Wins merge
    mesh_sync.rs        HTTP client and the background sync loop
src-tauri/tests/        integration tests (two-node sync, export/import, ...)
scripts/                release build, packaging and verification
```

## Data

Every device holds a complete copy of the vault in a single SQLite database.

- **Folders** nest to any depth; moves are cycle-checked.
- **Items** are notes, links, tickers, images and files. An item's `folder_id`
  of `NULL` means it lives in the Quick Inbox.
- **Revisions** are an append-only log of every change (`created`, `updated`,
  `moved`, `deleted`) with the originating device and a per-device monotonic
  timestamp. Sync is the exchange of this log.
- Deletes are soft (`is_deleted`), so a delete propagates like any other change.

### Media

Binary content never goes into a table row. Blobs live in `media/` next to the
database, named by the SHA-256 of their bytes:

- images are transcoded to WebP and stored as `<hash>.webp`;
- documents are stored verbatim as `<hash>.<ext>`, keeping their extension;
- items reference blobs as `/api/media/<hash>.<ext>`.

Content addressing gives de-duplication for free and lets the receiver verify
every transfer. Blobs no longer referenced by a live item are swept at start-up.

## Networking

There is no cloud component. All traffic stays on the local network.

### HTTP server

A small hand-written HTTP/1.1 server (`http_server.rs`) serves the compiled
frontend, the media files and a JSON API. It is intentionally dependency-free:
the same code cross-compiles to Android without a TLS or framework stack.
Connections are bounded, request bodies are size-capped, and the request path
never panics (the release profile aborts on panic).

### Discovery

Each device broadcasts a small JSON beacon every 5 seconds to UDP port 42424,
over multicast (`239.255.42.99`) and subnet broadcast. Many shared networks
(campus, office, hostel Wi-Fi) drop both between clients while still passing
unicast, so the beacon is also:

- sent directly to every peer already known, on every tick, and
- swept directly across the local /23 (about 500 addresses) at start-up and
  every 30 seconds.

A device that hears from a peer for the first time answers directly, so a single
sweep introduces both sides. Peers expire after 15 seconds of silence.

### Pairing

Two native apps pair by approval: one sends `POST /api/pair/request`, the other
shows an _Allow / Deny_ prompt, and the requester polls
`GET /api/pair/request?id=…` until it is answered. Allowing issues a random
token that both devices store; every later API call presents it.

Browsers, which cannot show the prompt on the other side, pair with a six-digit
PIN displayed only on the desktop. Both routes produce the same stored pairing.

### Sync

The sync loop runs every few seconds against each discovered, paired peer:

1. pull the peer's revisions since the last successful sync;
2. apply them, resolving conflicts by Last-Write-Wins on each row's timestamp;
3. fetch any media blob a live item references but the disk lacks, verifying
   its hash before it is kept;
4. push local revisions the peer has not seen.

Missing media is derived from local state rather than from the batch, so a
transfer that fails is retried on the next pass instead of being lost.

## Frontend

`src/services/storageService.ts` is the single boundary between the UI and the
data. Inside the desktop or Android app it calls Tauri commands; in a browser it
calls the HTTP API with the pairing token. Components never branch on platform
themselves.

## Backup

_Back up_ writes one zip containing every note as Markdown (with front matter),
the media files, and the database itself. _Restore_ merges an archive into the
current vault through the same revision machinery sync uses, so nothing present
locally is overwritten by an older copy.
