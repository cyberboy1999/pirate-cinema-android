# Pirate Cinema Android

This folder contains only the Android/Capacitor/Rust application.

## Rules
- Keep the app local-first. Do not add cloud persistence or transmit the library.
- Android uses embedded librqbit and the system player chooser. Do not add TorrServer, Artplayer, HLS.js, Electron or MPV.
- Never commit `_secrets`, signing keys, runtime databases, torrent payloads, caches, APKs or build outputs.
- Preserve per-file local history, the 384 MiB sparse LRU and TV D-pad accessibility.
- After changes update `docs/PROJECT.md` and run the checks below.

## Commands
- Full debug verification: `.\build-debug.ps1`
- Typecheck: `pnpm run mobile:typecheck`
- Tests: `pnpm test`
- Web/Capacitor sync: `pnpm run android:sync`
- Signed release: `.\build-release.ps1`

