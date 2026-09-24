# Android signing key

Android identifies an app by its signing certificate. A build signed with a
different key will not install over an existing one; the only way forward is to
uninstall, and uninstalling deletes that device's vault. Losing or replacing the
key is therefore the one mistake in this project with no clean recovery.

## The key

|             |                                                                         |
| :---------- | :---------------------------------------------------------------------- |
| Keystore    | `~/.omnivault-keys/omnivault-release.keystore` (outside the repository) |
| Credentials | `~/.omnivault-keys/keystore.properties` (never committed)               |
| Certificate | `CN=OmniVault, OU=OmniVault, O=OmniVault, C=IN`                         |
| SHA-256     | `34abdca6246cdf4c081b65ecbf1b6e89124c996011c91fd6b381a7e03a429ec5`      |

Every published APK must carry that fingerprint. `scripts/check_signing_key.mjs`
reads it from this file and `npm test` refuses to package an APK that differs.

`src-tauri/gen/android/app/build.gradle.kts` reads the signing configuration
from `keystore.properties`; see `keystore.properties.example` for the keys it
expects.

## Setting up a new machine

Copy `~/.omnivault-keys/` from the old machine **before** building anything. Do
not generate a new key because a build asks for one: it will appear to work, and
the result can never be installed over an existing copy.

## If the key is lost

The old identity cannot be recovered. Every existing user has to back up,
uninstall, install the new build and restore. The release notes for that build
must say so first, in plain words, before anyone installs it:

> This version is signed with a new key, so Android will not install it over
> your current copy. Open OmniVault, tap **Back up** and keep that file, then
> uninstall, install this version and use **Restore from a backup**. If you
> uninstall without backing up first, your notes are gone.
