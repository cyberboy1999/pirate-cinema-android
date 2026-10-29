# Android 0.6.1 release QA

Date: 2026-10-27  
Primary TV device: Xiaomi MiTV-AFKR0/Amlogic, Android 14/API 34, `armeabi-v7a`  
Application: `com.piratecinema.app`, versionCode 64

## Release gate

- TypeScript, mobile production build and 28 targeted Node tests pass.
- `TvFocusTest` passes on the physical TV box with real DPAD/OK events.
- Home, Search, Library, Settings, RuTube and Magnet navigation were exercised on-device.
- A cold start on the TV box completed in 2.2 seconds; the native logo splash is held for at least 1.2 seconds while the app initializes.
- Home DPAD focus moved from the rail through actions, recent torrents and popular cards and returned to the rail; the compact Search screen opened without an automatic keyboard.
- Text fields receive focus without opening IME and become editable only after OK.
- The real Sintel torrent restores, starts through librqbit and opens the Android system chooser; Vimu reports an advancing `PLAYING` media session.
- Release lint, pinned v2 signing certificate, APK ZIP alignment and 16 KiB ELF alignment pass for ARM32 and ARM64.
- No Pirate Cinema fatal exception, ANR, native fatal signal or OOM was found in the final logcat checks.
- The final code was installed as `com.piratecinema.app.qa` and cold-started on the TV box in 1.5 seconds after the last fixes. Updating the older `com.piratecinema.app` install was not claimed: Android rejected it because that historical build used a different signing certificate, and its user data was not deleted.

Historical stream, lifecycle, network recovery, storage and endurance evidence is retained in `docs/ANDROID_RELEASE_0.6.0_QA.md`; 0.6.1 also updates TV focus/navigation, the compact Search screen, cached popular posters and the native launch splash.

## Large torrent regression (2026-10-28)

- Device: Xiaomi MiTV-AFKR0/Amlogic, Android 14/API 34, `armeabi-v7a`, 1.0 GiB free before the test.
- Fixture: official Ubuntu 24.04.5.1 desktop torrent, one 6,250,332,160-byte file.
- Adding metadata completed in 0.043 seconds without reserving the full file size; the torrent reached `live`, 3 peers and 11.04 MiB/s.
- A bounded request for bytes `5,000,000,000-5,002,097,151` returned HTTP 206 and exactly 2,097,152 bytes in 5.21 seconds. This exercises the former 32-bit offset failure above 4 GiB.
- After pausing: 215,515,136 verified bytes, native heap PSS 14.1 MiB, total process PSS 114.8 MiB; logcat contained no `out of range`, write, ENOSPC, AndroidRuntime or fatal exception errors.
- The test torrent and cache were deleted; free space returned from 862 MiB to 1.0 GiB.
- This is not a full 6.25 GB download or long-duration playback claim. Devices with about 1 GiB free still cannot retain a complete 6.25 GB torrent; the cache remains bounded by the configured quota and available storage.

## External limitations

- Playback controls and codec support belong to the selected external player.
- Vimu's hardware SurfaceView may appear black in scrcpy while playback advances on the TV.
- DDD Video Player did not render this test stream.
- Physical ENOSPC exhaustion and sustained Wi-Fi-to-mobile-data transfer are not claimed as passed.

## 384 MiB librqbit LRU (2026-10-28)

- Android-хранилище ограничивает набор завершённых pieces каждой раздачи 384 МиБ; oldest-first вытеснение освобождает sparse-блоки и уведомляет chunk tracker, чтобы последующая перемотка могла скачать piece заново.
- При активном Range-потоке scheduler обслуживает stream priority и не продолжает фоновую загрузку всего файла.
- ARMv7 release-библиотека с этим изменением собрана и установлена на Xiaomi MiTV-AFKR0. Исходниковые регрессионные проверки и Rust-компиляция проходят.
- Нагрузочный прогон официальной Ubuntu-раздачи выше 384 МиБ пока не завершён: в повторном сеансе все 12 обнаруженных пиров были недоступны (`dead`), получено 0 байт. Поэтому физическое удержание объёма и повторная загрузка уже вытесненного начала файла пока не отмечены как успешные.

## RuTor search regression (2026-10-28)

- Причина сообщения «поиск не работает» воспроизведена на Xiaomi MiTV-AFKR0: первый запрос молча загружал сжатый индекс размером 51 056 763 байта, поэтому интерфейс выглядел бездействующим.
- Экран теперь показывает статус и spinner, блокирует повторную отправку и начинает фоновый прогрев индекса при входе в раздел поиска.
- На тестовой приставке холодная загрузка и первый старый потоковый поиск занимали около трёх минут, а повторный — около 28 секунд. После исправления Rust один раз за 32,83 с построил компактный индекс из уже скачанного каталога. Затем запрос `Matrix` завершился за 2,730 с и вернул 40 результатов, `Sintel` — за 2,733 с и вернул 7 результатов. Приложение не упало и не зависло.
- После принудительной остановки и холодного запуска сохранённый компактный индекс открылся за 2 мс без перестроения; повторный запрос `Matrix` завершился за 2,624 с и вернул 40 результатов. DPAD сохранил управляемый фокус, клавиатура сама не открылась, а проверка API после навигации показала пустой список раздач — поиск ничего не добавил автоматически.
- Компактный индекс строится потоково, имеет лимиты общего размера и длины записи, создаётся через временный файл и автоматически перестраивается после обновления исходного суточного индекса.
- Случайно добавленная автоматизацией тестовая раздача `The Matrix` (`b563b566563509b7fe4e177692578af6b120b2a0`) была точно идентифицирована и удалена вместе с данными; список QA librqbit снова пуст.

## Seek buffering regression (2026-10-28)

- Зависание на позиции 5:35 воспроизведено с `The Matrix`: при 500 МиБ свободного места прежний storage guard с резервом 512 МиБ перевёл активную раздачу в `paused`. Резерв уменьшен до 128 МиБ с учётом отдельного LRU-лимита 384 МиБ; инструментальный тест границ прошёл на Xiaomi MiTV-AFKR0.
- После устранения автопаузы обнаружено, что несколько закрытых/заменённых Range-запросов конкурировали в случайном порядке: bitfield показывал загрузку pieces прежней позиции, пока новый seek не получал данных. Scheduler теперь детерминированно отдаёт приоритет самому новому Range; добавлен регрессионный тест, ARMv7-библиотека пересобрана и QA APK установлен поверх профиля без очистки данных.
- Физическая отдача последнего Range пока не отмечена успешной: в контрольном прогоне два доступных пира передали только 0,9 МиБ за 180 секунд и не завершили один 4-МиБ piece. Torrent оставался `live`, повторной автопаузы, краша и OOM не было. Повторить seek-проверку необходимо при доступном быстром пире.

## Physical phone seek and LRU regression (2026-10-29)

- Device: Infinix X6853, ARM64, USB. Изолированный профиль `com.piratecinema.app.dev` установлен параллельно существующим production/QA-профилям без удаления их данных.
- Реальный magnet `e65d3548f30476021969e0ce90f2815704ad6283` разрешился в один файл размером 26 228 254 998 байт. При трёх живых пирах скорость достигала 14,69 MiB/s; Android chooser открыл установленный mpv, фактический видеокадр отображался.
- mpv продолжил воспроизведение после последовательных seek вперёд до 321 секунды и назад до 233 секунд. Media session оставалась `PLAYING`; librqbit оставался `live`, без crash, ANR и OOM.
- За прогон было получено 2 439 762 476 байт, при этом `file_progress` удерживался ровно на 402 653 184 байтах (384 МиБ). Это физически подтверждает LRU-границу и повторную загрузку диапазона после перемотки на ARM64-телефоне.
- Перед открытием внешнего плеера приложение теперь ждёт первый проверенный torrent piece. Наличие одного медленного пира больше не считается готовым буфером; через 30 секунд показывается диагностическая ошибка со скоростью и количеством пиров. Инструментальный тест этого условия прошёл на телефоне.
