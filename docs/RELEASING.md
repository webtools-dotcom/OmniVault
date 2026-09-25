# Releasing

The app only ever looks at GitHub Releases, so code that is pushed but not
released reaches nobody. Follow these steps in order.

## 1. Bump the version

Four files declare the version and must agree — `npm test` fails if they do not:

| File                                      | Used for                                        |
| :---------------------------------------- | :---------------------------------------------- |
| `package.json`                            | source of truth; read by every packaging script |
| `src-tauri/tauri.conf.json`               | desktop build and the Android manifest          |
| `src/services/updates.ts` (`APP_VERSION`) | the in-app update check                         |
| `src-tauri/Cargo.toml`                    | the Rust crate                                  |

**Versions only go up.** Android orders upgrades by `versionCode`, which is
derived from the version, and refuses a lower one. Going backwards forces an
uninstall, and uninstalling deletes the device's vault.

## 2. Build and package

```bash
npm run build:release && npm run package:windows
npm run build:android && npm run package:android
npm test
```

`npm run build:android` clears Gradle's output when the version has changed
since the last build; Gradle does not track `tauri.properties` as an input and
would otherwise ship the previous version in the manifest. If you build Android
another way, delete `src-tauri/gen/android/app/build` yourself after a bump.

Packaging enforces the size budgets, writes `SHA256SUMS.txt` and
`RELEASE_NOTES.md`, and uses `aapt2` to verify the APK's signing certificate and
declared version. Nothing is published until `npm test` passes.

## 3. Publish

```bash
gh release create vX.Y.Z \
  "release/omnivault-vX.Y.Z-windows-x64.zip" \
  "release/omnivault-vX.Y.Z-android.apk" \
  "release/omnivault.exe" \
  "release/SHA256SUMS.txt" \
  --title "OmniVault vX.Y.Z" \
  --notes-file "release/RELEASE_NOTES.md"
```

Then confirm the upload: list the assets with
`gh api repos/<owner>/<repo>/releases/<id>/assets`, download one back, and check
it against `SHA256SUMS.txt`.

## Things that cannot be undone

- **The Android signing key never changes.** See
  [ANDROID_SIGNING.md](ANDROID_SIGNING.md).
- **A release someone has downloaded cannot be withdrawn.** Replacing a version
  is only acceptable while its download counts are zero — check them first.

## In-app updates

_Check for updates_ asks the releases page once and offers _Update now_ if the
latest tag is newer than `APP_VERSION`. Nothing happens in the background.

- **Windows** downloads `omnivault-vX.Y.Z-windows-x64.zip` and
  `SHA256SUMS.txt` with the system `curl.exe`, verifies the zip, swaps in the
  new `omnivault.exe` (and `dist/`, if present) and restarts. Leftovers are
  removed on the next start.
- **Android** downloads `omnivault-vX.Y.Z-android.apk` and hands it to the
  system installer, which asks the user to confirm. The first time, Android
  also asks the user to allow OmniVault to install updates.

Both depend on the asset names above, so keep them unchanged.
