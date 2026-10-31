import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {serverCandidates} from "../app/mobile/torrserver.mjs";
import {androidRelease,writeStorageTransaction,safeMobileHistory,safeMobileMetadata} from "../app/mobile/torrserver.mjs";

test("Android discovery retains custom endpoints and both local server ports",()=>{
  const custom="http://192.168.1.42:9000";
  const hosts=serverCandidates(custom,"192.168.1.");
  assert.equal(hosts[0],custom);
  for(const host of ["127.0.0.1","10.0.2.2"])for(const port of [8090,8091])assert.ok(hosts.includes(`http://${host}:${port}`));
  assert.equal(hosts.length,new Set(hosts).size);
  assert.equal(serverCandidates("http://127.0.0.1:8091").length,4);
});
import {createMobileBackup,enableRutorSearch,episodeNumbers,magnetInfoHash,metadataQueries,metadataQuery,mpvIntent,newerVersion,nextUnviewedFile,normalizeCinemeta,normalizeTorrent,normalizeTvmaze,parseMobileBackup,pickCinemeta,playbackHistoryEntry,probeTorrServer,releaseQuality,removeTorrentHistory,sameRelease,sortEpisodeFiles,streamUrl,updatePlaybackHistory} from "../app/mobile/torrserver.mjs";

test("mobile client reads torrent files and builds librqbit player links",()=>{
  const item=normalizeTorrent({hash:"a".repeat(40),title:"Series",data:JSON.stringify({TorrServer:{Files:[{id:7,path:"S01/E02.mkv",length:42},{id:8,path:"cover.jpg",length:2}]}})});
  assert.equal(item.files.length,1);assert.equal(item.files[0].id,7);
  const url=streamUrl("http://127.0.0.1:8090/",item.hash,item.files[0]);
  assert.match(url,/\/torrents\/[a-f0-9]{40}\/stream\/7\/E02\.mkv$/);assert.match(mpvIntent(url,item.title),/package=is\.xyz\.mpv/);
});

test("mobile client enables RuTor without replacing other TorrServer settings",()=>{
  assert.deepEqual(enableRutorSearch({CacheSize:64,EnableRutorSearch:false}),{CacheSize:64,EnableRutorSearch:true});
  assert.equal(enableRutorSearch({EnableRutorSearch:true}),null);
});

test("mobile client stores mpv result and clears position after completion",()=>{
  const media={hash:"a".repeat(40),fileId:7,fileName:"Episode.mkv",title:"Series"};
  const saved=playbackHistoryEntry(null,{ok:true,positionMs:125000,durationMs:1500000},media,"2026-09-17T00:00:00.000Z");
  assert.equal(saved.positionMs,125000);assert.equal(saved.durationMs,1500000);assert.equal(saved.completed,false);
  assert.equal(playbackHistoryEntry(saved,{ok:true,completed:true},media).positionMs,0);
});

test("mobile client updates and removes local per-file history",()=>{
  const history={"a:1":{hash:"a",positionMs:50,completed:false},"b:2":{hash:"b",positionMs:20,completed:false}};
  assert.deepEqual(updatePlaybackHistory(history,"a:1",{completed:true,positionMs:0})["a:1"],{hash:"a",positionMs:0,completed:true});
  assert.deepEqual(removeTorrentHistory(history,"a"),{"b:2":history["b:2"]});
});

test("mobile client prepares release names and Cinemeta metadata",()=>{
  assert.equal(metadataQuery("Interstellar.2014.UHD.BDRip.2160p.4K"),"Interstellar 2014");
  assert.equal(metadataQuery("Shogun.S01E02.1080p.WEB-DL"),"Shogun");
  assert.deepEqual(metadataQueries("Сёгун / Shogun.S01E02.1080p.WEB-DL"),["Сёгун","Shogun"]);
  assert.deepEqual(normalizeCinemeta({id:"tt1",name:"Movie",releaseInfo:"2024",poster:"p",imdbRating:"7.5"}),{id:"tt1",title:"Movie",year:2024,poster:"p",backdrop:"",description:"",rating:7.5,genres:[]});
  assert.deepEqual(normalizeTvmaze({show:{id:7,name:"Show",premiered:"2024-01-02",image:{original:"poster"},summary:"<p>Story</p>",rating:{average:8.2},genres:["Drama"],externals:{imdb:"tt7"}}}),{id:"tt7",title:"Show",year:2024,poster:"poster",backdrop:"",description:"Story",rating:8.2,genres:["Drama"]});
  assert.equal(pickCinemeta([{name:"Interstellar"},{name:"Sintel",id:"right"}],"Sintel").id,"right");
  assert.equal(pickCinemeta([{name:"Interstellar"}],"Sintel"),undefined);
  assert.equal(pickCinemeta([{name:"Dune",releaseInfo:"1984",id:"old"},{name:"Dune",releaseInfo:"2021",id:"new"}],"Dune 2021").id,"new");
});

test("mobile client validates portable local backups",()=>{
  const hash="a".repeat(40),entry={hash,fileId:0,fileName:"movie.mkv",title:"Movie",positionMs:42,durationMs:60,completed:false,lastPlayedAt:"2026-09-17T00:00:00.000Z"};
  const content=createMobileBackup({serverUrl:"http://127.0.0.1:8090",player:"mpv",history:{[`${hash}:0`]:entry},metadata:{}},"2026-09-17T00:00:00.000Z");
  assert.equal(parseMobileBackup(content).history[`${hash}:0`].hash,hash);
  assert.throws(()=>parseMobileBackup('{"schema":2}'),/Неподдерживаемая/);
});

test("mobile client groups episodes and finds the next unviewed file",()=>{
  assert.deepEqual(episodeNumbers("Season 2/Show.S02E03.mkv"),{season:2,episode:3});
  const files=sortEpisodeFiles([{id:8,path:"S02E01.mkv",season:2,episode:1},{id:7,path:"S01E02.mkv",season:1,episode:2}]);
  assert.deepEqual(files.map(file=>file.id),[7,8]);
  assert.equal(nextUnviewedFile(files,{"h:7":{completed:true}},"h",7).id,8);
});

test("mobile client recognizes duplicate hex and base32 magnet hashes",()=>{
  assert.equal(magnetInfoHash(`magnet:?xt=urn:btih:${"A".repeat(40)}`),"a".repeat(40));
  assert.equal(magnetInfoHash("magnet:?xt=urn:btih:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),"0".repeat(40));
  assert.equal(magnetInfoHash("https://example.test/not-a-magnet"),null);
  assert.equal(magnetInfoHash(`https://evil.test/?xt=urn:btih:${"a".repeat(40)}`),null);
});

test("mobile search groups release quality and warns about the same title",()=>{
  assert.equal(releaseQuality("Dune.2021.2160p.UHD.BluRay"),"2160p");
  assert.equal(releaseQuality("Dune.2021.1080i.BDRip"),"1080p");
  assert.equal(releaseQuality("Dune.2021.720p.WEB-DL"),"720p");
  assert.equal(releaseQuality("Dune.2021.DVDRip"),"other");
  assert.equal(sameRelease("Дюна.2021.1080p", "Дюна (2021) BDRip"),true);
  assert.equal(sameRelease("Дюна / Dune (2021) 1080p", "Дюна.2021.BDRip"),true);
  assert.equal(sameRelease("Movie.2021.480p.x264", "Movie (2021) BDRip"),true);
  assert.equal(sameRelease("Дюна (1984)", "Дюна (2021)"),false);
  assert.equal(sameRelease("Movie.2100.1080p", "Movie.2098.BDRip"),false);
  assert.equal(sameRelease("Дюна (2021)", "Прибытие (2021)"),false);
});

test("mobile search uses the native Android keyboard",()=>{
  const source=readFileSync(new URL("../app/mobile/page.tsx",import.meta.url),"utf8");
  assert.doesNotMatch(source,/VirtualKeyboard|Экранная клавиатура|styles\.keyboard|inputMode\s*=/);
  assert.ok((source.match(/<input enterKeyHint="search"/g)||[]).length>=2);
});

test("Android TV welcome keeps the engine address out of D-pad focus and fits a 1080p screen",()=>{
  const css=readFileSync(new URL("../app/mobile/mobile.module.css",import.meta.url),"utf8");
  assert.match(css,/\.tvMode \.welcome\{padding:16px 24px\}/);
  assert.match(css,/\.tvMode \.welcomeLogo\{width:42px;height:42px/);
  assert.match(css,/\.tvMode \.welcome label\{display:none\}/);
});

test("Android keeps torrent payloads in an app cache that is cleared between engine runs",()=>{
  const plugin=readFileSync(new URL("../android/app/src/main/java/com/piratecinema/app/LibrqbitPlugin.java",import.meta.url),"utf8");
  const rust=readFileSync(new URL("../android/rust/src/lib.rs",import.meta.url),"utf8");
  assert.match(plugin,/nativeStart\(String dataDirectory,String cacheDirectory\)/);
  assert.match(plugin,/getCacheDir\(\).*librqbit-stream/s);
  assert.match(rust,/fn reset_payload_cache/);
  assert.match(rust,/reset_payload_cache\(&payload_dir\)/);
  assert.match(rust,/remove_dir_all\(&payload_dir\)/);
});

test("Android librqbit grows large cache files on demand and preserves 64-bit offsets",()=>{
  const storage=readFileSync(new URL("../android/vendor/librqbit/src/storage/filesystem/fs.rs",import.meta.url),"utf8");
  const file=readFileSync(new URL("../android/vendor/librqbit/src/storage/filesystem/opened_file.rs",import.meta.url),"utf8");
  assert.match(storage,/cfg\(target_os = "android"\)[\s\S]*fn ensure_file_length[\s\S]*Ok\(\(\)\)/);
  assert.match(file,/cfg\(all\(unix, target_pointer_width = "32"\)\)[\s\S]*self\.pwrite_all\(offset \+ written as u64/);
});

test("Android uses only the system player",()=>{
  const system=readFileSync(new URL("../app/mobile/SystemPlayer.tsx",import.meta.url),"utf8");
  const page=readFileSync(new URL("../app/mobile/page.tsx",import.meta.url),"utf8");
  const rutube=readFileSync(new URL("../app/mobile/Rutube.tsx",import.meta.url),"utf8");
  const css=readFileSync(new URL("../app/mobile/mobile.module.css",import.meta.url),"utf8");
  assert.match(page,/import EmbeddedPlayer from "\.\/SystemPlayer\.tsx"/);
  assert.match(rutube,/import EmbeddedPlayer from "\.\/SystemPlayer\.tsx"/);
  assert.match(system,/ExternalPlayer\.open\(\{url:source,title,preferred:"system"/);
  assert.match(system,/rutube\.ru\/api\/play\/options/);
  assert.match(page,/localStorage\.setItem\("pirate-cinema-mobile-player",\s*"system"\)/);
  assert.doesNotMatch(page,/Artplayer|type Player|choosePlayer|preferredPlayer/);
  assert.match(css,/\.players button:first-child\{display:none\}/);
  assert.match(page,/\/update_only_files.*\/start.*method:\s*"POST"/s);
});

test("Android torrent HLS prefers hardware H.264 with a software fallback",()=>{
  const source=readFileSync(new URL("../android/app/src/main/java/com/piratecinema/app/TorrentMediaPlugin.java",import.meta.url),"utf8");
  assert.match(source,/h264_mediacodec/);
  assert.match(source,/libx264/);
  assert.doesNotMatch(source,/isEmulator/);
  assert.match(source,/args\.add\("h264_mediacodec"\)/);
  assert.match(source,/"-pix_fmt","nv12","-b:v"/);
  assert.match(source,/\+genpts\+ignidx/);
  assert.match(source,/current\.source\.startsWith\("http:\/\/"\).*"-fflags","\+genpts\+ignidx"/);
  assert.doesNotMatch(source,/"-flags2","\+showall"/);
  assert.match(source,/"-frames:v","144"/);
  assert.match(source,/done\.await\(250,TimeUnit\.MILLISECONDS\)/);
  assert.match(source,/args\.contains\("h264_mediacodec"\)\?15:90/);
  assert.match(source,/!failure\.startsWith\("Не удалось отменить"\)/);
  assert.match(source,/args\.contains\("h264_mediacodec"\).*!failure\.startsWith/s);
  assert.match(source,/finally\{sessions\.remove\(session\.getSessionId\(\)\);\}/);
  assert.match(source,/if\(current\.closed\)\{partial\.delete\(\);throw new IOException\("Поток закрыт"\);\}/);
  assert.match(source,/finally\{if\(current\.closed\)cleanupMedia\(current\);\}/);
  assert.doesNotMatch(source,/commands\.execute\(\(\)->\{Media current=media/);
});

test("Android builds include 32-bit TV boxes while retaining x86_64 emulator support",()=>{
  const gradle=readFileSync(new URL("../android/app/build.gradle",import.meta.url),"utf8");
  assert.match(gradle,/'-t', 'arm64-v8a', '-t', 'armeabi-v7a', '-t', 'x86_64'/);
  assert.match(gradle,/defaultConfig[\s\S]*abiFilters 'arm64-v8a', 'armeabi-v7a', 'x86_64'/);
  assert.match(gradle,/release \{\s*ndk \{ abiFilters 'arm64-v8a', 'armeabi-v7a' \}/);
  assert.match(gradle,/max-page-size=16384/);
  const media=readFileSync(new URL("../android/app/src/main/java/com/piratecinema/app/TorrentMediaPlugin.java",import.meta.url),"utf8");
  assert.match(media,/SUPPORTED_64_BIT_ABIS\.length==0[\s\S]*result\.put\("url",source\)/);
});

test("completed Android torrents use their local file for resilient AVI seeking",()=>{
  const source=readFileSync(new URL("../android/app/src/main/java/com/piratecinema/app/TorrentMediaPlugin.java",import.meta.url),"utf8");
  assert.match(source,/stats\/v1/);
  assert.match(source,/optBoolean\("finished",false\)/);
  assert.match(source,/librqbit\/downloads/);
  assert.match(source,/next\.source=playbackSource/);
  assert.match(source,/if\(!stats\.optBoolean\("finished",false\)\)return source/);
  assert.match(source,/session\/session\.json/);
  assert.match(source,/matches\.size\(\)==1/);
  assert.match(source,/if\(cancelled\.contains\(token\)\)throw new IOException\("Подготовка отменена"\);\s*media=next/);
});

test("Android librqbit keeps a 384 MiB sparse LRU and can reacquire evicted stream pieces",()=>{
  const fs=readFileSync(new URL("../android/vendor/librqbit/src/storage/filesystem/fs.rs",import.meta.url),"utf8");
  const opened=readFileSync(new URL("../android/vendor/librqbit/src/storage/filesystem/opened_file.rs",import.meta.url),"utf8");
  const storage=readFileSync(new URL("../android/vendor/librqbit/src/storage/mod.rs",import.meta.url),"utf8");
  const chunks=readFileSync(new URL("../android/vendor/librqbit/src/chunk_tracker.rs",import.meta.url),"utf8");
  const pieces=readFileSync(new URL("../android/vendor/librqbit/src/piece_tracker.rs",import.meta.url),"utf8");
  const live=readFileSync(new URL("../android/vendor/librqbit/src/torrent_state/live/mod.rs",import.meta.url),"utf8");
  const streams=readFileSync(new URL("../android/vendor/librqbit/src/torrent_state/streaming.rs",import.meta.url),"utf8");
  assert.match(fs,/ANDROID_CACHE_CAPACITY:\s*u64\s*=\s*384\s*\*\s*1024\s*\*\s*1024/);
  assert.match(opened,/FALLOC_FL_PUNCH_HOLE\s*\|\s*libc::FALLOC_FL_KEEP_SIZE/);
  assert.match(storage,/fn take_evicted_pieces\(&self\) -> Vec<ValidPieceIndex>/);
  assert.match(chunks,/pub fn mark_piece_evicted/);
  assert.match(pieces,/set_priority_only/);
  assert.match(live,/take_evicted_pieces\(\)[\s\S]*mark_piece_evicted/);
  assert.match(live,/set_priority_only\(self\.state\.streams\.has_active\(\)\)/);
  assert.match(streams,/pub\(crate\) fn has_active/);
});

test("Android librqbit prioritizes the newest Range after a seek",()=>{
  const streams=readFileSync(new URL("../android/vendor/librqbit/src/torrent_state/streaming.rs",import.meta.url),"utf8");
  assert.match(streams,/sort_unstable_by_key\(\|\(id, _\)\| Reverse\(\*id\)\)/);
  assert.doesNotMatch(streams,/all\.shuffle/);
});

test("Android system player keeps the app back stack and external chooser",()=>{
  const page=readFileSync(new URL("../app/mobile/page.tsx",import.meta.url),"utf8");
  const player=readFileSync(new URL("../app/mobile/SystemPlayer.tsx",import.meta.url),"utf8");
  const activity=readFileSync(new URL("../android/app/src/main/java/com/piratecinema/app/MainActivity.java",import.meta.url),"utf8");
  assert.match(player,/preferred:"system"/);
  assert.match(player,/Выбрать другой плеер/);
  assert.match(player,/const result=await ExternalPlayer\.open/);
  assert.match(player,/onProgress\?\.\(\(result\.positionMs\?\?position\*1000\)\/1000/);
  assert.doesNotMatch(player,/artplayer|hls\.js/i);
  assert.match(page,/import EmbeddedPlayer from "\.\/SystemPlayer\.tsx"/);
  assert.match(page,/await selectEmbedded\(selected, file/);
  assert.match(activity,/if\(handling\)return/);
  const external=readFileSync(new URL("../android/app/src/main/java/com/piratecinema/app/ExternalPlayerPlugin.java",import.meta.url),"utf8");
  assert.match(external,/prepareTorrent\(uri\)/);
  assert.match(external,/update_only_files/);
  assert.match(external,/base \+ "\/start"/);
  assert.match(external,/selection == 400 && !isLive\(base\)/);
  assert.match(external,/start == 400 && !isLive\(base\)/);
  assert.match(external,/waitForPeer\(base\)/);
  assert.match(external,/elapsedRealtime\(\) \+ 30_000/);
  assert.match(external,/Нет доступных пиров/);
  assert.match(external,/TorrentService\.storageWarning/);
  assert.match(external,/Intent\.createChooser\(intent, "Открыть с помощью"\)/);
  assert.doesNotMatch(external,/setClassName\(|MPVActivity/);
  assert.match(activity,/if\(location\.hash==='#player'\)\{history\.back\(\);return true\}/);
  assert.match(activity,/postDelayed\(\(\)->handling=false,300\)/);
});

test("Android TV uses a full-screen rail and spatial D-pad navigation",()=>{
  const page=readFileSync(new URL("../app/mobile/page.tsx",import.meta.url),"utf8");
  const focus=readFileSync(new URL("../app/mobile/tvFocus.ts",import.meta.url),"utf8");
  const css=readFileSync(new URL("../app/mobile/mobile.module.css",import.meta.url),"utf8");
  assert.match(page,/useTvFocus\(tvMode/);
  assert.match(page,/aria-current=\{section\s*===\s*"home"\s*\?\s*"page"\s*:\s*undefined\}/);
  assert.match(focus,/ArrowLeft.*ArrowRight.*ArrowUp.*ArrowDown/);
  assert.match(focus,/scrollIntoView\(\{block:"nearest",inline:"nearest"\}\)/);
  assert.match(focus,/button\[aria-label\^='Закрыть'].*surfaces/s);
  assert.match(focus,/right\.z-left\.z\|\|right\.index-left\.index/);
  assert.match(focus,/textFieldSelector/);
  assert.match(focus,/element\.readOnly=true/);
  assert.match(focus,/event\.key==="Enter".*unlock\(active\)/s);
  assert.match(focus,/lock\(active\).*const elements=focusable\(\)/s);
  assert.match(focus,/direction\[0\]<0&&!active\.closest\("nav"\).*current\.focus\(\)/s);
  assert.match(focus,/inNav\?Boolean\(element\.closest\("nav"\)\):!element\.closest\("nav"\)/);
  assert.match(focus,/cross\*\(direction\[0\]\?\.75:\.35\)/);
  assert.match(focus,/event\.preventDefault\(\);\s*if\(next\)/);
  assert.match(page,/welcome\s*\?\s*"welcome"\s*:\s*"ready"/);
  assert.match(page,/pirate-cinema-mobile-tvmaze-consent/);
  assert.doesNotMatch(page,/\?\?choices\[0\]/);
  assert.match(css,/\.tvMode\.stage\{padding:0/);
  assert.match(css,/\.tvMode \.nav\{left:0;right:auto/);
  assert.match(css,/outline:3px solid var\(--accent\)/);
  assert.match(css,/\.phone\{padding-bottom:112px\}\.nav\{bottom:40px\}\.fab\{bottom:112px\}/);
});

test("mobile home caches its catalog and lazy-loads popular posters",()=>{
  const page=readFileSync(new URL("../app/mobile/page.tsx",import.meta.url),"utf8");
  const activity=readFileSync(new URL("../android/app/src/main/java/com/piratecinema/app/MainActivity.java",import.meta.url),"utf8");
  assert.match(page,/POPULAR_TTL\s*=\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  assert.match(page,/Date\.now\(\)\s*-\s*cached\.updatedAt\s*<\s*POPULAR_TTL/);
  assert.match(page,/cached\.items\.slice\(0,\s*12\)\.map\(normalizeCinemeta\)/);
  assert.match(page,/localStorage\.removeItem\(POPULAR_CACHE\)/);
  assert.match(page,/loading="lazy" decoding="async" referrerPolicy="no-referrer"/);
  assert.match(page,/wsrv\.nl\/\?url=.*w=420&output=jpg&q=80/);
  assert.match(page,/setTimeout\(\(\)\s*=>\s*void loadPopular\(\),\s*15000\)/);
  assert.match(activity,/SplashScreen\.installSplashScreen\(this\)/);
  assert.match(activity,/setKeepOnScreenCondition.*<1200/);
  assert.match(activity,/UI_MODE_TYPE_TELEVISION/);
  assert.match(activity,/SCREEN_ORIENTATION_PORTRAIT/);
  assert.match(page,/metadata-consent['"]\)\s*!==\s*['"]no['"]/);
  const release=readFileSync(new URL("../scripts/build-android-release.ps1",import.meta.url),"utf8");
  assert.match(release,/foreach\(\$abi in @\('arm64-v8a','armeabi-v7a'\)\)/);
  assert.match(release,/\$abi\/libpirate_cinema_librqbit\.so/);
});

test("mobile search keeps the full result set visible without secondary filters",()=>{
  const page=readFileSync(new URL("../app/mobile/page.tsx",import.meta.url),"utf8");
  const plugin=readFileSync(new URL("../android/app/src/main/java/com/piratecinema/app/TorrentSearchPlugin.java",import.meta.url),"utf8");
  const css=readFileSync(new URL("../app/mobile/mobile.module.css",import.meta.url),"utf8");
  assert.match(page,/styles\.searchPage/);
  assert.match(page,/results\.map\(\(item,\s*index\)/);
  assert.doesNotMatch(page,/searchQuality|filteredResults|setSearchQuality/);
  assert.match(page,/if\s*\(!busy\)\s*void search\(\)/);
  assert.match(page,/type="submit" disabled=\{busy\}/);
  assert.match(page,/role="status"/);
  assert.match(page,/первый поиск может занять несколько минут/);
  assert.match(page,/next\s*===\s*"search".*TorrentSearch\.warmup\(\)/s);
  assert.match(plugin,/@PluginMethod\s+public void warmup/);
  assert.match(plugin,/nativePrepareSearchIndex\(index\.getAbsolutePath\(\)\)/);
  assert.match(plugin,/File candidate = ensureIndex\(\)/);
  assert.match(page,/section\s*===\s*"rutube"\s*\|\|\s*section\s*===\s*"library"/);
  assert.match(css,/\.searchPage \.results\{height:calc\(100% - 56px\)\}/);
});

test("mobile update comparison ignores older GitHub releases",()=>{
  assert.equal(newerVersion("v0.5.9","0.5.8"),true);
  assert.equal(newerVersion("v0.5.7","0.5.8"),false);
  assert.equal(newerVersion("v0.5.8","0.5.8"),false);
  assert.equal(newerVersion("android-v0.6.0-rc.2","0.6.0-rc.1"),true);
  assert.equal(newerVersion("android-v0.6.0","0.6.0-rc.2"),true);
  assert.equal(newerVersion("android-v0.6.0-rc.2","0.6.0"),false);
  const release={tag_name:"android-v0.6.0-rc.2",prerelease:true,assets:[{name:"Pirate-Cinema-Android-0.6.0-rc.2-arm64-v8a.apk",browser_download_url:"https://github.com/cyberboy1999/pirate-cinema/releases/download/android-v0.6.0-rc.2/a.apk"}]};
  assert.ok(androidRelease([release],"0.6.0-rc.1"));assert.equal(androidRelease([release],"0.6.0"),null);
  assert.equal(androidRelease([{...release,assets:[{...release.assets[0],browser_download_url:"https://evil.example/a.apk"}]}],"0.6.0-rc.1"),null);
});

test("mobile backup includes RuTube and validates records before restore",()=>{
  const video={id:"a".repeat(32),url:`https://rutube.ru/video/${"a".repeat(32)}/`,title:"Owned fixture",position:42,duration:60,completed:false};
  const backup=createMobileBackup({serverUrl:"http://127.0.0.1:3030",player:"mpv",history:{},metadata:{},rutube:[video],rutubeQueue:[video],rutubePlaylists:[{url:"https://rutube.ru/plst/123/",videos:[video]}]});
  const restored=parseMobileBackup(backup);assert.equal(restored.schema,2);assert.equal(restored.rutube[0].position,42);assert.equal(restored.rutubePlaylists[0].videos[0].id,video.id);
  assert.throws(()=>parseMobileBackup(JSON.stringify({...restored,history:[]})));
  assert.throws(()=>parseMobileBackup(JSON.stringify({...restored,history:{bad:{positionMs:-1}}})));
  assert.throws(()=>parseMobileBackup(JSON.stringify({...restored,history:{a:{},b:{}}})));
  assert.throws(()=>parseMobileBackup(JSON.stringify({...restored,metadata:{["a".repeat(40)]:{genres:"bad"}}})));
  assert.throws(()=>parseMobileBackup(JSON.stringify({...restored,serverUrl:"javascript:bad"})));
  assert.throws(()=>parseMobileBackup(" ".repeat(5_000_001)));
  assert.deepEqual(parseMobileBackup(JSON.stringify({...restored,schema:1,rutube:undefined})).rutube,[]);
});

test("quota failure rolls back backup writes and malformed startup data cannot crash render",()=>{
  const values=new Map([["history","original"],["metadata","old"]]);
  const storage={getItem:key=>values.get(key)??null,removeItem:key=>values.delete(key),setItem(key,value){if([...values.entries()].filter(([name])=>name!==key).reduce((size,[,text])=>size+text.length,0)+value.length>30)throw new Error("QuotaExceeded");values.set(key,value)}};
  assert.throws(()=>writeStorageTransaction(storage,{safety:"snapshot",history:"replacement",metadata:"x".repeat(40)}),/Quota/);
  assert.deepEqual(Object.fromEntries(values),{history:"original",metadata:"old"});
  writeStorageTransaction(storage,{history:"new",metadata:"updated"});assert.equal(values.get("history"),"new");
  assert.deepEqual(safeMobileHistory({a:{},b:{}}),{});assert.deepEqual(safeMobileMetadata({a:{genres:"bad"}}),{});
});

test("mobile TorrServer discovery probes the LAN in bounded batches",async()=>{
  const hosts=Array.from({length:40},(_,index)=>`http://192.168.1.${index+1}:8090`);
  let active=0,peak=0;
  const found=await probeTorrServer(hosts,async url=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,1));active--;return {ok:url===`${hosts[20]}/echo`}});
  assert.equal(found,hosts[20]);assert.ok(peak<=16);
});
