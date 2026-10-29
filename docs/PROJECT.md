# Pirate Cinema Android — project overview

## Scope

This repository contains the standalone Android phone, tablet and Android TV
application. It is local-first and does not require TorrServer, Electron, MPV,
Artplayer or HLS.js.

## Runtime architecture

1. React renders the phone and TV interfaces inside a Capacitor WebView.
2. Capacitor plugins bridge the UI to the Android foreground service.
3. Rust JNI embeds librqbit for magnet and `.torrent` processing.
4. A loopback-only HTTP Range endpoint exposes the selected torrent file.
5. Android opens the stream through the system player chooser.

Torrent state, per-file playback history and the sparse 384 MiB LRU cache remain
on the device. Cinemeta metadata is enabled by default and can be disabled.
TVmaze access requires separate consent.

## Source layout

- `app/mobile/` — Android UI, search, metadata and system-player integration.
- `mobile/` — Vite entry point and global styles.
- `android/app/` — Android application, service, plugins and UI tests.
- `android/rust/` — JNI bridge and embedded torrent runtime.
- `android/vendor/librqbit/` — pinned librqbit 9.0.1 source.
- `tests/` — Node unit and integration tests.
- `scripts/` — release and license-generation helpers.

## Supported release targets

The public release APK contains ARM64 and ARMv7 native libraries. Debug builds
also contain x86_64 for Android emulators. Version `0.6.1` is the initial release
of this standalone repository.

## Verification

```powershell
pnpm install --frozen-lockfile
pnpm run mobile:typecheck
pnpm test
pnpm run android:sync
cd android
.\gradlew.bat test lint assembleDebug
```

The self-contained local checkout can run `.\build-debug.ps1`. A signed release
is produced with `.\build-release.ps1`; signing credentials must stay outside
Git and are supplied through environment variables or the ignored `_secrets`
directory.

## Release policy

- update the version in `package.json` and `android/version.properties`;
- run the complete debug and signed-release verification;
- verify the APK certificate, ABI set, alignment and SHA-256 file;
- create a Git tag named `v<version>`;
- attach the APK and `SHA256SUMS` to the matching GitHub Release;
- never commit APKs, signing keys, caches, databases or torrent payloads.

