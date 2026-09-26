// Frontend regression tests.
//
// Most of these are static checks over the source: they pin down fixes for
// bugs that only reproduce on a phone, in a release build or on a network we
// cannot simulate here. The QR and copy-out tests exercise the modules directly.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import esbuild from "esbuild";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf-8");

function listFiles(dir, pattern) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(rel, pattern));
    else if (pattern.test(entry.name)) out.push(rel);
  }
  return out;
}

async function importTs(rel) {
  const js = esbuild.transformSync(read(rel), { loader: "ts", format: "esm" }).code;
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
}

const uiFiles = listFiles("src", /\.tsx?$/);
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

test("every Tailwind utility used in src/ exists in the compiled CSS", () => {
  // Fractional spacing and a few v4-only names compile to nothing on Tailwind 3.
  const assets = path.join(root, "dist/assets");
  assert.ok(fs.existsSync(assets), "run `npm run build` first");
  const css = fs
    .readdirSync(assets)
    .filter((f) => f.endsWith(".css"))
    .map((f) => fs.readFileSync(path.join(assets, f), "utf-8"))
    .join("\n");
  const source = listFiles("src", /\.(tsx?|html)$/)
    .map(read)
    .join("\n");

  const fragile = new Set(
    source.match(
      /\b(?:w|h|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y|min-w|max-w|min-h|max-h|top|left|right|bottom|inset|size)-\d+\.\d+\b/g,
    ) ?? [],
  );
  for (const name of ["shadow-xs", "backdrop-blur-xs", "scrollbar-none"]) {
    if (source.includes(name)) fragile.add(name);
  }
  const missing = [...fragile].filter((cls) => !css.includes("." + cls.replace(".", "\\.")));
  assert.deepEqual(missing, []);
});

test("UI density scales the root font size, not CSS zoom", () => {
  // `zoom` does not compensate viewport units and leaves dead strips at the edges.
  assert.doesNotMatch(read("src/App.tsx"), /\.zoom\s*=\s*String\(/);
  assert.match(read("src/index.css"), /--ui-scale/);
});

test("the app shell follows the visible viewport height", () => {
  // 100vh on mobile browsers includes the hidden address bar.
  const shell = read("src/components/layout/AppLayout.tsx").match(/^.*app-viewport.*$/m)?.[0];
  assert.ok(shell, "AppLayout no longer uses .app-viewport");
  assert.doesNotMatch(shell, /\bh-screen\b/);
  const css = read("src/index.css");
  assert.match(css, /\.app-viewport\s*\{[^}]*100vh[^}]*100dvh/);
});

test("the editor autosave does not re-run on every parent render", () => {
  const editor = read("src/components/editor/NoteEditorModal.tsx");
  const deps = editor.match(/\},\s*\[\s*title,\s*content[^\]]*\]\s*\);/)?.[0];
  assert.ok(deps, "could not find the autosave effect");
  assert.doesNotMatch(deps, /\bonSave\b/);
  assert.match(editor, /onSaveRef\.current\(/);
});

test("the HTTP request path cannot panic", () => {
  // The release profile aborts on panic, so one bad request would kill the app.
  const server = read("src-tauri/src/http_server.rs");
  const requestPath = server.slice(0, server.indexOf("#[cfg(test)]"));
  const unwraps = requestPath
    .split("\n")
    .filter((line) => line.includes(".unwrap()"))
    .map((line) => line.trim());
  assert.deepEqual(unwraps, []);
  assert.match(requestPath, /fn lock_recover/);
});

test("links built from note content go through safeHref", () => {
  for (const file of [
    "src/utils/markdown.tsx",
    "src/components/research/SmartMarketLauncher.tsx",
  ]) {
    const src = read(file);
    const dynamic = (src.match(/href=\{(?!`https|"https)/g) ?? []).length;
    const guarded = (src.match(/safeHref\(/g) ?? []).length;
    assert.ok(
      guarded >= dynamic,
      `${file}: ${dynamic} dynamic href(s), ${guarded} safeHref call(s)`,
    );
  }
  const safeUrl = read("src/utils/safeUrl.ts");
  for (const scheme of ["http", "https", "mailto"]) assert.ok(safeUrl.includes(`"${scheme}"`));
  assert.doesNotMatch(safeUrl, /["']javascript["']/);
});

test("pasted images are uploaded rather than stored inline", () => {
  const app = read("src/App.tsx");
  const start = app.indexOf("onPasteImage");
  const handler = app.slice(start, app.indexOf("});", start));
  assert.match(handler, /uploadMedia/);

  const storage = read("src/services/storageService.ts");
  const start2 = storage.indexOf("async uploadMedia");
  const upload = storage.slice(start2, storage.indexOf("\n  },", start2));
  assert.match(upload, /VaultWriteError/, "a failed upload must raise, not fall back silently");
});

test("the Android release build may load its own media over loopback", () => {
  // Release APKs disable cleartext HTTP, which also blocks the local server.
  const config = read("src-tauri/gen/android/app/src/main/res/xml/network_security_config.xml");
  assert.match(config, /<domain[^>]*>127\.0\.0\.1<\/domain>/);
  assert.match(config, /<base-config[^>]*cleartextTrafficPermitted="false"/);
  assert.match(
    read("src-tauri/gen/android/app/src/main/AndroidManifest.xml"),
    /@xml\/network_security_config/,
  );
});

test("the UI uses only design tokens, bundled fonts and no emoji", () => {
  const palette =
    /\b(?:bg|text|border|ring|from|to|via|fill|stroke|decoration|placeholder|shadow)-(?:indigo|violet|purple|blue|emerald|green|teal|cyan|amber|yellow|orange|red|rose|pink|fuchsia|sky|lime|zinc|slate|gray|neutral|stone)-\d{2,3}\b/;
  const offenders = uiFiles.filter((f) => palette.test(read(f)) || EMOJI.test(read(f)));
  assert.deepEqual(offenders, []);

  const tailwind = read("tailwind.config.js");
  for (const token of ["#0D0E11", "#E9EAEF", "#79C2A4", "#DE8A80", "#12131A"]) {
    assert.ok(tailwind.includes(token), `tailwind.config.js lost ${token}`);
  }
  for (const font of ["archivo-latin.woff2", "fraunces-latin.woff2"]) {
    assert.ok(fs.existsSync(path.join(root, "public/fonts", font)), `${font} is not bundled`);
  }
});

test("the version is declared identically everywhere", () => {
  const version = JSON.parse(read("package.json")).version;
  assert.equal(JSON.parse(read("src-tauri/tauri.conf.json")).version, version);
  assert.equal(read("src/services/updates.ts").match(/APP_VERSION = "([^"]+)"/)?.[1], version);
  assert.equal(read("src-tauri/Cargo.toml").match(/^version\s*=\s*"([^"]+)"/m)?.[1], version);

  for (const script of [
    "scripts/package_android.mjs",
    "scripts/package_windows.mjs",
    "scripts/check_signing_key.mjs",
  ]) {
    const src = read(script);
    assert.doesNotMatch(
      src,
      /(?:omnivault-v|OmniVault v)\d+\.\d+\.\d+/,
      `${script} hardcodes a version`,
    );
    assert.match(
      src,
      /VERSION\s*=\s*JSON\.parse/,
      `${script} must read the version from package.json`,
    );
  }
});

test("the signing guide records the release certificate fingerprint", () => {
  assert.match(read("docs/ANDROID_SIGNING.md"), /\b[0-9a-f]{64}\b/);
});

test("the README and release notes do not overstate what the app does", () => {
  const packager = read("scripts/package_windows.mjs");
  const notesStart = packager.indexOf("const releaseNotesContent");
  const notes = packager.slice(notesStart, packager.indexOf("\n`;", notesStart));
  assert.ok(notesStart > -1 && notes.length > 0, "release-notes template not found");

  for (const [name, text] of [
    ["README.md", read("README.md")],
    ["release notes", notes],
  ]) {
    assert.doesNotMatch(
      text,
      /encrypted\s+(?:TCP|streams?|transport|sync|channel|connection)/i,
      name,
    );
    assert.doesNotMatch(text, /end-to-end\s+encrypt/i, name);
    assert.doesNotMatch(text, /\bmDNS\b/, name);
    // Apple platforms may only be mentioned to say they are not supported.
    for (const sentence of text.replace(/\s+/g, " ").split(/(?<=[.!])\s/)) {
      if (/\b(?:iPhone|iPad|iOS|macOS)\b/.test(sentence)) {
        assert.match(sentence, /\b(?:no|not|never|without|only)\b/i, `${name}: "${sentence}"`);
      }
    }
  }
});

test("touch devices can reach every card action and cannot delete by accident", () => {
  const card = read("src/components/inbox/QuickInboxItemCard.tsx");
  const actions = card.match(/^.*group-hover:opacity-100.*$/m)?.[0] ?? "";
  assert.match(actions, /\[@media\(hover:none\)\]:opacity-100/, "actions are hover-only");
  assert.match(card, /armedToDelete/, "two-tap delete on touch is gone");

  const editor = read("src/components/editor/NoteEditorModal.tsx");
  assert.match(editor, /innerWidth\s*<\s*768\s*\?\s*"edit"/, "phones must default to the editor");
});

test("a browser never displays a pairing PIN it was not issued", () => {
  const modal = read("src/components/pairing/QrConnectModal.tsx");
  assert.doesNotMatch(modal, /useState<string[^>]*>\((["'])\d{3}\s?\d{3}\1\)/);
  assert.match(read("src/components/pairing/PairingGuide.tsx"), /showsOwnPin/);
  assert.match(modal, /showsOwnPin=\{/);
});

test("the QR encoder produces decodable codes", async () => {
  // Golden hashes come from matrices verified with a real decoder. If one
  // changes, re-verify with a decoder before updating it.
  const { generateQrMatrix } = await importTs("src/utils/qrCode.ts");
  const golden = [
    ["http://192.168.1.5:42420", 25, "d46ccc1b7a3cdc9b"],
    ["http://10.0.0.2:42420", 25, "e1f405c444cf29da"],
  ];

  for (const [url, size, hash] of golden) {
    const m = generateQrMatrix(url);
    assert.equal(m.length, size);

    for (const [r, c] of [
      [0, 0],
      [0, size - 7],
      [size - 7, 0],
    ]) {
      assert.ok(m[r][c] && m[r + 6][c] && m[r][c + 6] && m[r + 3][c + 3], "finder pattern");
      assert.ok(!m[r + 1][c + 1], "finder ring is hollow");
    }

    const align = { 25: 18, 29: 22, 33: 26 }[size];
    assert.ok(m[align][align] && !m[align - 1][align] && m[align - 2][align], "alignment pattern");

    for (let i = 8; i < size - 8; i++) {
      assert.equal(m[6][i], i % 2 === 0, "timing row");
      assert.equal(m[i][6], i % 2 === 0, "timing column");
    }

    const bits = m.map((row) => row.map((cell) => (cell ? "1" : "0")).join("")).join("");
    assert.equal(crypto.createHash("sha256").update(bits).digest("hex").slice(0, 16), hash);
  }
});

test("copying a note does not repeat a title that begins its body", async () => {
  const { copyableText } = await importTs("src/utils/copyText.ts");
  assert.equal(
    copyableText("Exited JAINREC.NS", "Exited JAINREC.NS at 294"),
    "Exited JAINREC.NS at 294",
  );
  assert.equal(copyableText("Trade log", "Exited at 294"), "Trade log\n\nExited at 294");
  assert.equal(copyableText("Only a title", ""), "Only a title");
  assert.equal(copyableText("", "Only a body"), "Only a body");
});
