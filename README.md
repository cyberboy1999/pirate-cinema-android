# Pirate Cinema Android

[Русский](#русский) · [English](#english)

## Русский

Pirate Cinema Android — локальное приложение для поиска, сохранения и потокового
воспроизведения торрент-раздач на телефонах, планшетах и Android TV. Торрент-движок
`librqbit` встроен в APK; TorrServer и облачный аккаунт не требуются.

### Возможности

- magnet-ссылки и `.torrent`-файлы;
- локальный поиск по каталогу RuTor;
- выбор файла, сезона и серии;
- воспроизведение до полной загрузки через системный выбор видеоплеера;
- восстановление сохранённых раздач и отдельная история каждого файла;
- RuTube: поиск, сохранённые ролики и плейлисты;
- метаданные Cinemeta, включённые по умолчанию и отключаемые в настройках;
- телефонный интерфейс и отдельная D-pad-навигация Android TV;
- ограниченный sparse-LRU-кэш 384 МиБ вместо сохранения всего большого торрента;
- ARM64 и ARMv7 в release APK, x86_64 в debug-сборке для эмулятора.

### Установка

1. Откройте [Releases](https://github.com/cyberboy1999/pirate-cinema-android/releases).
2. Скачайте `Pirate-Cinema-Android-0.6.1-arm32-arm64.apk` и при необходимости
   сравните SHA-256 с `SHA256SUMS`.
3. Разрешите установку из выбранного браузера или файлового менеджера.
4. Установите любой внешний видеоплеер. Контейнеры, кодеки, дорожки и управление
   воспроизведением зависят от выбранного плеера.

Android может показать предупреждение для APK, установленного не из Google Play.
Не устанавливайте APK из сторонних зеркал.

### Приватность и безопасность

- медиатека, история, торрент-сессии и кэш хранятся только на устройстве;
- локальный HTTP Range-сервер слушает loopback-интерфейс;
- очищенные названия отправляются в Cinemeta для описаний; это отключается в
  настройках, а TVmaze требует отдельного согласия;
- ключи подписи, runtime-базы, торрент-кэш и APK не входят в репозиторий;
- Android cloud backup и перенос данных средствами ОС отключены; резервная копия
  экспортируется пользователем вручную.

### Архитектура

```text
React + Capacitor WebView
        ↓
Java plugins / foreground service
        ↓
Rust JNI + librqbit
        ↓
локальный HTTP Range stream
        ↓
Android system player chooser
```

Встроенного видеоплеера, Artplayer, HLS.js, MPV и TorrServer в Android-сборке нет.

### Разработка и проверка

Требуются Node.js 22+, pnpm, JDK 21, Android SDK/NDK и Rust с `cargo-ndk`.

```powershell
pnpm install --frozen-lockfile
pnpm run mobile:typecheck
pnpm test
pnpm run android:sync
cd android
.\gradlew.bat assembleDebug
```

Автономная локальная копия может использовать `build-debug.ps1`; локальные
toolchains и signing-файлы намеренно исключены из Git.

Release собирается только постоянным ключом:

```powershell
.\scripts\build-android-release.ps1 -SigningDirectory 'C:\secure\android-signing'
```

Скрипт проверяет typecheck, тесты, lint, package ID, сертификат, обе release ABI,
16-КиБ ELF alignment и создаёт `SHA256SUMS`.

### Проверенное состояние 0.6.1

- 31 unit/regression test прошёл;
- release lint и подписанная сборка прошли;
- ARM64 проверен на Infinix X6853;
- ARMv7 проверен на Xiaomi MiTV-AFKR0/Amlogic;
- реальный 26,2-ГБ torrent воспроизводился до полной загрузки; seek вперёд и
  назад продолжал воспроизведение, а локальный кэш оставался в пределах 384 МиБ;
- APK подписан RSA-4096 сертификатом Pirate Cinema.

Подробный QA-отчёт находится в `docs/ANDROID_RELEASE_0.6.1_QA.md`.

### Ограничения

- доступность и скорость зависят от пиров и сети;
- совместимость контейнеров и кодеков зависит от внешнего плеера;
- первый холодный поиск загружает и строит локальный индекс и может занять время;
- воспроизведение защищённого DRM-контента не поддерживается;
- приложение не предоставляет контент: пользователь отвечает за соблюдение
  законодательства и прав правообладателей.

## English

Pirate Cinema Android is a local-first torrent search, library and streaming
application for phones, tablets and Android TV. The `librqbit` engine is embedded
in the APK; no TorrServer instance or cloud account is required.

### Features

- magnet links and `.torrent` files;
- local RuTor catalogue search;
- file, season and episode selection;
- playback before a full download through the Android system player chooser;
- restored torrent sessions and per-file playback history;
- RuTube search, saved videos and playlists;
- Cinemeta metadata enabled by default and switchable in Settings;
- phone layout plus dedicated Android TV D-pad navigation;
- a bounded 384 MiB sparse LRU cache instead of retaining an entire large torrent;
- ARM64 and ARMv7 in the release APK, with x86_64 in debug builds for emulators.

### Installation

1. Open [Releases](https://github.com/cyberboy1999/pirate-cinema-android/releases).
2. Download `Pirate-Cinema-Android-0.6.1-arm32-arm64.apk` and optionally verify
   it against `SHA256SUMS`.
3. Allow installation from the browser or file manager you used.
4. Install an external video player. Container, codec, track and remote-control
   support depend on that player.

Android may display a warning for APKs installed outside Google Play. Do not
install APKs from third-party mirrors.

### Privacy and security

- the library, history, torrent sessions and cache remain on the device;
- the local HTTP Range server listens on the loopback interface;
- cleaned titles are sent to Cinemeta for metadata; this can be disabled in
  Settings, while TVmaze fallback requires separate consent;
- signing keys, runtime databases, torrent cache and APKs are excluded from Git;
- Android cloud backup and OS device transfer are disabled; backups are exported
  manually by the user.

### Architecture

```text
React + Capacitor WebView
        ↓
Java plugins / foreground service
        ↓
Rust JNI + librqbit
        ↓
local HTTP Range stream
        ↓
Android system player chooser
```

The Android package does not contain an embedded player, Artplayer, HLS.js, MPV
or TorrServer.

### Development and verification

Node.js 22+, pnpm, JDK 21, Android SDK/NDK, Rust and `cargo-ndk` are required.

```powershell
pnpm install --frozen-lockfile
pnpm run mobile:typecheck
pnpm test
pnpm run android:sync
cd android
.\gradlew.bat assembleDebug
```

The standalone local workspace may use `build-debug.ps1`; local toolchains and
signing material are intentionally excluded from Git.

Production releases must use the permanent signing identity:

```powershell
.\scripts\build-android-release.ps1 -SigningDirectory 'C:\secure\android-signing'
```

The script verifies type checking, tests, lint, package ID, signing certificate,
both release ABIs and 16 KiB ELF alignment, then produces `SHA256SUMS`.

### Verified 0.6.1 status

- all 31 unit/regression tests pass;
- release lint and the signed release build pass;
- ARM64 was tested on an Infinix X6853;
- ARMv7 was tested on a Xiaomi MiTV-AFKR0/Amlogic device;
- a real 26.2 GB torrent played before completion; forward and backward seeking
  resumed playback while retained cache data stayed within 384 MiB;
- the APK is signed with the Pirate Cinema RSA-4096 certificate.

See `docs/ANDROID_RELEASE_0.6.1_QA.md` for the detailed QA record.

### Limitations

- availability and startup speed depend on peers and network conditions;
- container and codec compatibility depends on the selected external player;
- the first cold search downloads and builds a local index and may take time;
- DRM-protected playback is not supported;
- the application does not provide media; users are responsible for complying
  with applicable law and copyright requirements.

## License

GPL-3.0-only. Third-party notices are provided in `THIRD_PARTY_NOTICES.md` and
the release APK assets.
