//! Embedded librqbit engine for the Android client.

use std::{
    fs::File,
    io::{BufRead, BufReader, BufWriter, Read, Write},
    net::{Ipv4Addr, SocketAddr},
    panic::{AssertUnwindSafe, catch_unwind},
    path::PathBuf,
    sync::{Mutex, OnceLock, mpsc},
    thread,
};

use anyhow::{Context, Result};
use flate2::read::DeflateDecoder;
use jni::{
    JNIEnv,
    objects::{JClass, JString},
    sys::{JNI_FALSE, JNI_TRUE, jboolean, jstring},
};
use librqbit::http_api::{HttpApi, HttpApiOptions};
use librqbit::{Api, Session, SessionOptions, SessionPersistenceConfig};
use librqbit_dualstack_sockets::{BindOpts, TcpListener};
use serde::{
    Deserialize, Serialize,
    de::{Deserializer, Error, SeqAccess, Visitor},
};
use tokio::sync::oneshot;

const HTTP_PORT: u16 = 3030;
const MAX_SEARCH_INDEX_BYTES: u64 = 80 * 1024 * 1024;
const MAX_SEARCH_JSON_BYTES: u64 = 320 * 1024 * 1024;
const MAX_JSON_STRING_BYTES: usize = 16 * 1024;
const MAX_NAMES: usize = 64;
const MAX_COMPACT_INDEX_BYTES: u64 = 256 * 1024 * 1024;
const MAX_COMPACT_LINE_BYTES: usize = 128 * 1024;
const COMPACT_INDEX_MAGIC: &[u8] = b"PCIDX1\n";

struct LimitedJsonRead<R> {
    inner: R,
    total: u64,
    in_string: bool,
    escaped: bool,
    string_bytes: usize,
}
impl<R: Read> Read for LimitedJsonRead<R> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        let count = self.inner.read(buffer)?;
        self.total = self.total.saturating_add(count as u64);
        if self.total > MAX_SEARCH_JSON_BYTES {
            return Err(std::io::Error::other("search JSON is too large"));
        }
        for byte in &buffer[..count] {
            if self.in_string {
                if self.escaped {
                    self.escaped = false;
                } else if *byte == b'\\' {
                    self.escaped = true;
                } else if *byte == b'"' {
                    self.in_string = false;
                    self.string_bytes = 0;
                    continue;
                }
                self.string_bytes += 1;
                if self.string_bytes > MAX_JSON_STRING_BYTES {
                    return Err(std::io::Error::other("search JSON string is too large"));
                }
            } else if *byte == b'"' {
                self.in_string = true;
                self.string_bytes = 0;
            }
        }
        Ok(count)
    }
}

#[derive(Default, Serialize)]
struct BoundedNames(Vec<String>);
impl<'de> Deserialize<'de> for BoundedNames {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct NamesVisitor;
        impl<'de> Visitor<'de> for NamesVisitor {
            type Value = BoundedNames;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("null or a bounded names array")
            }
            fn visit_none<E: Error>(self) -> Result<Self::Value, E> {
                Ok(BoundedNames::default())
            }
            fn visit_unit<E: Error>(self) -> Result<Self::Value, E> {
                Ok(BoundedNames::default())
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
                let mut names = Vec::new();
                while let Some(name) = seq.next_element()? {
                    if names.len() == MAX_NAMES {
                        return Err(A::Error::custom("too many alternate names"));
                    }
                    names.push(name);
                }
                Ok(BoundedNames(names))
            }
        }
        deserializer.deserialize_any(NamesVisitor)
    }
}

#[derive(Default, Deserialize, Serialize)]
#[serde(default, rename_all = "PascalCase")]
struct SearchItem {
    title: String,
    name: String,
    names: BoundedNames,
    size: String,
    create_date: String,
    tracker: String,
    magnet: String,
    hash: String,
    #[serde(rename = "IMDBID")]
    imdbid: String,
    year: i32,
    peer: i32,
    seed: i32,
    video_quality: i32,
    #[serde(skip)]
    score: i32,
}

fn normalize(value: &str) -> String {
    value
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|v| !v.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn valid_search_item(item: &SearchItem) -> bool {
    item.hash.len() == 40
        && item.hash.chars().all(|c| c.is_ascii_hexdigit())
        && item.magnet.to_ascii_lowercase().starts_with("magnet:?")
}

fn searchable(item: &SearchItem) -> String {
    normalize(&format!(
        "{} {} {} {}",
        item.title,
        item.name,
        item.names.0.join(" "),
        item.year
    ))
}

fn build_compact_search_index(source: &std::path::Path, target: &std::path::Path) -> Result<()> {
    struct CompactItems<'a, W: Write> {
        writer: &'a mut W,
        written: u64,
    }
    impl<'de, W: Write> Visitor<'de> for CompactItems<'_, W> {
        type Value = ();
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("a RuTor array")
        }
        fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
            let mut this = self;
            while let Some(item) = seq.next_element::<SearchItem>()? {
                if !valid_search_item(&item) {
                    continue;
                }
                let key = searchable(&item);
                let json = serde_json::to_vec(&item).map_err(A::Error::custom)?;
                let line_bytes = key.len().saturating_add(json.len()).saturating_add(2);
                if line_bytes > MAX_COMPACT_LINE_BYTES {
                    continue;
                }
                this.written = this.written.saturating_add(line_bytes as u64);
                if this.written > MAX_COMPACT_INDEX_BYTES {
                    return Err(A::Error::custom("compact search index is too large"));
                }
                this.writer
                    .write_all(key.as_bytes())
                    .map_err(A::Error::custom)?;
                this.writer.write_all(b"\t").map_err(A::Error::custom)?;
                this.writer.write_all(&json).map_err(A::Error::custom)?;
                this.writer.write_all(b"\n").map_err(A::Error::custom)?;
            }
            Ok(())
        }
    }
    let file = File::open(source)?;
    if file.metadata()?.len() > MAX_SEARCH_INDEX_BYTES {
        anyhow::bail!("compressed search index is too large");
    }
    let temporary = target.with_extension("idx.tmp");
    let mut output = BufWriter::with_capacity(256 * 1024, File::create(&temporary)?);
    output.write_all(COMPACT_INDEX_MAGIC)?;
    let reader = BufReader::with_capacity(
        256 * 1024,
        LimitedJsonRead {
            inner: DeflateDecoder::new(file),
            total: 0,
            in_string: false,
            escaped: false,
            string_bytes: 0,
        },
    );
    let mut deserializer = serde_json::Deserializer::from_reader(reader);
    deserializer.deserialize_seq(CompactItems {
        writer: &mut output,
        written: COMPACT_INDEX_MAGIC.len() as u64,
    })?;
    output.flush()?;
    drop(output);
    #[cfg(windows)]
    if target.exists() {
        std::fs::remove_file(target)?;
    }
    std::fs::rename(&temporary, target)?;
    Ok(())
}

fn compact_search_index(source: &std::path::Path) -> Result<PathBuf> {
    let target = source.with_extension("idx");
    let source_modified = source.metadata()?.modified()?;
    let fresh = target
        .metadata()
        .ok()
        .filter(|metadata| {
            metadata.len() >= COMPACT_INDEX_MAGIC.len() as u64
                && metadata.len() <= MAX_COMPACT_INDEX_BYTES
                && metadata
                    .modified()
                    .is_ok_and(|modified| modified >= source_modified)
        })
        .and_then(|_| File::open(&target).ok())
        .is_some_and(|mut file| {
            let mut magic = [0_u8; COMPACT_INDEX_MAGIC.len()];
            file.read_exact(&mut magic).is_ok() && magic == COMPACT_INDEX_MAGIC
        });
    if !fresh {
        build_compact_search_index(source, &target)?;
    }
    Ok(target)
}

fn search_index(path: &std::path::Path, query: &str) -> Result<String> {
    let normalized = normalize(query);
    if normalized.chars().count() < 2 {
        anyhow::bail!("search query must contain at least two letters or digits");
    }
    let compact = compact_search_index(path)?;
    let mut reader = BufReader::with_capacity(256 * 1024, File::open(compact)?);
    let mut magic = Vec::new();
    reader.read_until(b'\n', &mut magic)?;
    if magic != COMPACT_INDEX_MAGIC {
        anyhow::bail!("invalid compact search index");
    }
    let tokens: Vec<&str> = normalized.split_whitespace().collect();
    let mut matches = Vec::new();
    let mut line = Vec::new();
    while reader.read_until(b'\n', &mut line)? != 0 {
        if line.len() > MAX_COMPACT_LINE_BYTES {
            anyhow::bail!("compact search index line is too large");
        }
        if line.last() == Some(&b'\n') {
            line.pop();
        }
        if let Some(separator) = line.iter().position(|byte| *byte == b'\t') {
            let key = std::str::from_utf8(&line[..separator])?;
            if tokens.iter().all(|token| key.contains(token)) {
                let mut item: SearchItem = serde_json::from_slice(&line[separator + 1..])?;
                item.score = if key.contains(&normalized) { 10_000 } else { 0 }
                    + item.seed.saturating_mul(10).saturating_add(item.peer);
                matches.push(item);
                if matches.len() > 40 {
                    rank_results(&mut matches);
                    matches.truncate(40);
                }
            }
        }
        line.clear();
    }
    rank_results(&mut matches);
    matches.truncate(40);
    Ok(serde_json::to_string(&matches)?)
}

fn rank_results(items: &mut [SearchItem]) {
    items.sort_unstable_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| b.seed.cmp(&a.seed))
            .then_with(|| b.create_date.cmp(&a.create_date))
    });
}

struct RunningEngine {
    shutdown: oneshot::Sender<()>,
    thread: thread::JoinHandle<()>,
}

static ENGINE: OnceLock<Mutex<Option<RunningEngine>>> = OnceLock::new();

fn engine_slot() -> &'static Mutex<Option<RunningEngine>> {
    ENGINE.get_or_init(|| Mutex::new(None))
}

fn clear_payload_cache(path: &std::path::Path) -> Result<()> {
    if let Ok(metadata) = std::fs::symlink_metadata(path) {
        anyhow::ensure!(
            !metadata.file_type().is_symlink(),
            "torrent cache must not be a symlink"
        );
        std::fs::remove_dir_all(path)?;
    }
    Ok(())
}

fn reset_payload_cache(path: &std::path::Path) -> Result<()> {
    clear_payload_cache(path)?;
    std::fs::create_dir_all(path)?;
    Ok(())
}

fn pause_saved_session(path: &std::path::Path, payload_dir: &std::path::Path) -> Result<()> {
    let input = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    anyhow::ensure!(
        input.metadata()?.len() <= 4 * 1024 * 1024,
        "saved session is too large"
    );
    let mut value: serde_json::Value = serde_json::from_reader(input)?;
    if let Some(torrents) = value
        .get_mut("torrents")
        .and_then(serde_json::Value::as_object_mut)
    {
        for torrent in torrents.values_mut() {
            if let Some(paused) = torrent.get_mut("is_paused") {
                *paused = serde_json::Value::Bool(true);
            }
            if let Some(hash) = torrent.get("info_hash").and_then(serde_json::Value::as_str) {
                anyhow::ensure!(
                    hash.len() == 40 && hash.chars().all(|c| c.is_ascii_hexdigit()),
                    "invalid saved info hash"
                );
                torrent["output_folder"] = serde_json::Value::String(
                    payload_dir
                        .join(hash.to_ascii_lowercase())
                        .to_string_lossy()
                        .into_owned(),
                );
            }
        }
    }
    let temporary = path.with_extension("json.part");
    std::fs::write(&temporary, serde_json::to_vec(&value)?)?;
    std::fs::rename(temporary, path)?;
    Ok(())
}

fn start_engine(data_dir: PathBuf, payload_dir: PathBuf) -> Result<()> {
    let mut slot = engine_slot()
        .lock()
        .map_err(|_| anyhow::anyhow!("engine lock poisoned"))?;
    if slot.is_some() {
        return Ok(());
    }

    // librqbit owns the CORS layer. Set its narrow WebView origin allowlist
    // before this library creates any Rust runtime worker threads.
    unsafe {
        std::env::set_var(
            "CORS_ALLOW_REGEXP",
            r"^(https?|capacitor)://localhost(?::\d+)?$",
        );
    }

    let (started_tx, started_rx) = mpsc::sync_channel(1);
    let startup_error_tx = started_tx.clone();
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    let thread = thread::Builder::new()
        .name("librqbit-runtime".into())
        .spawn(move || {
            let runtime = match tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
            {
                Ok(runtime) => runtime,
                Err(error) => {
                    let _ = started_tx.send(Err(anyhow::anyhow!(error)));
                    return;
                }
            };
            runtime.block_on(async move {
                if let Err(error) = run_engine(data_dir, payload_dir, shutdown_rx, started_tx).await
                {
                    let _ = startup_error_tx.send(Err(anyhow::anyhow!("{error:#}")));
                    tracing::error!(?error, "librqbit engine stopped with an error");
                }
            });
        })
        .context("failed to create librqbit runtime thread")?;

    started_rx
        .recv()
        .context("librqbit runtime exited during startup")??;
    *slot = Some(RunningEngine {
        shutdown: shutdown_tx,
        thread,
    });
    Ok(())
}

async fn run_engine(
    data_dir: PathBuf,
    payload_dir: PathBuf,
    shutdown_rx: oneshot::Receiver<()>,
    started_tx: mpsc::SyncSender<Result<()>>,
) -> Result<()> {
    let state = data_dir.join("session");
    clear_payload_cache(&data_dir.join("downloads"))?;
    reset_payload_cache(&payload_dir)?;
    std::fs::create_dir_all(&state)?;
    pause_saved_session(&state.join("session.json"), &payload_dir)?;

    let session = Session::new_with_opts(
        payload_dir.clone(),
        SessionOptions {
            dht: Some(librqbit::DhtSessionConfig {
                persistence: Some(librqbit::dht::DhtPersistenceConfig {
                    config_filename: Some(data_dir.join("dht.json")),
                    ..Default::default()
                }),
                ..Default::default()
            }),
            fastresume: true,
            persistence: Some(SessionPersistenceConfig::Json {
                folder: Some(state),
            }),
            concurrent_init_limit: Some(2),
            runtime_worker_threads: Some(2),
            peer_limit: Some(80),
            ipv4_only: true,
            ..Default::default()
        },
    )
    .await
    .context("failed to initialize librqbit session")?;

    let listener = TcpListener::bind_tcp(
        SocketAddr::from((Ipv4Addr::LOCALHOST, HTTP_PORT)),
        BindOpts::default(),
    )
    .context("failed to bind librqbit HTTP server to loopback")?;
    let server = HttpApi::new(
        Api::new(session.clone(), None, None),
        Some(HttpApiOptions {
            max_upload_body_size: Some(10 * 1024 * 1024),
            ..Default::default()
        }),
    )
    .make_http_api_and_run(listener, None);

    let _ = started_tx.send(Ok(()));
    tokio::select! {
        result = server => result?,
        _ = shutdown_rx => {}
    }
    session.stop().await;
    drop(session);
    if payload_dir.exists() {
        std::fs::remove_dir_all(&payload_dir).context("failed to clear torrent cache")?;
    }
    Ok(())
}

fn stop_engine() -> Result<()> {
    let running = engine_slot()
        .lock()
        .map_err(|_| anyhow::anyhow!("engine lock poisoned"))?
        .take();
    if let Some(running) = running {
        let _ = running.shutdown.send(());
        running
            .thread
            .join()
            .map_err(|_| anyhow::anyhow!("librqbit runtime panicked"))?;
    }
    Ok(())
}

fn jni_guard(env: &mut JNIEnv<'_>, operation: impl FnOnce() -> Result<()>) -> jboolean {
    match catch_unwind(AssertUnwindSafe(operation)) {
        Ok(Ok(())) => JNI_TRUE,
        Ok(Err(error)) => {
            let _ = env.throw_new("java/lang/IllegalStateException", format!("{error:#}"));
            JNI_FALSE
        }
        Err(_) => {
            let _ = env.throw_new(
                "java/lang/IllegalStateException",
                "panic in librqbit JNI boundary",
            );
            JNI_FALSE
        }
    }
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_piratecinema_app_LibrqbitPlugin_nativeStart(
    mut env: JNIEnv<'_>,
    _class: JClass<'_>,
    data_dir: JString<'_>,
    cache_dir: JString<'_>,
) -> jboolean {
    let path = match env.get_string(&data_dir) {
        Ok(path) => PathBuf::from(path.to_string_lossy().into_owned()),
        Err(error) => {
            let _ = env.throw_new("java/lang/IllegalArgumentException", error.to_string());
            return JNI_FALSE;
        }
    };
    let cache = match env.get_string(&cache_dir) {
        Ok(path) => PathBuf::from(path.to_string_lossy().into_owned()),
        Err(error) => {
            let _ = env.throw_new("java/lang/IllegalArgumentException", error.to_string());
            return JNI_FALSE;
        }
    };
    jni_guard(&mut env, || start_engine(path, cache))
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_piratecinema_app_LibrqbitPlugin_nativeStop(
    mut env: JNIEnv<'_>,
    _class: JClass<'_>,
) -> jboolean {
    jni_guard(&mut env, stop_engine)
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_piratecinema_app_TorrentSearchPlugin_nativeSearchIndex(
    mut env: JNIEnv<'_>,
    _class: JClass<'_>,
    path: JString<'_>,
    query: JString<'_>,
) -> jstring {
    let result = catch_unwind(AssertUnwindSafe(|| -> Result<String> {
        let path = PathBuf::from(env.get_string(&path)?.to_string_lossy().into_owned());
        let query = env.get_string(&query)?.to_string_lossy().into_owned();
        search_index(&path, &query)
    }));
    match result {
        Ok(Ok(value)) => match env.new_string(value) {
            Ok(value) => value.into_raw(),
            Err(error) => {
                let _ = env.throw_new("java/lang/IllegalStateException", error.to_string());
                std::ptr::null_mut()
            }
        },
        Ok(Err(error)) => {
            let _ = env.throw_new("java/lang/IllegalStateException", format!("{error:#}"));
            std::ptr::null_mut()
        }
        Err(_) => {
            let _ = env.throw_new(
                "java/lang/IllegalStateException",
                "panic in torrent search JNI boundary",
            );
            std::ptr::null_mut()
        }
    }
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_piratecinema_app_TorrentSearchPlugin_nativePrepareSearchIndex(
    mut env: JNIEnv<'_>,
    _class: JClass<'_>,
    path: JString<'_>,
) -> jboolean {
    let path = match env.get_string(&path) {
        Ok(path) => PathBuf::from(path.to_string_lossy().into_owned()),
        Err(error) => {
            let _ = env.throw_new("java/lang/IllegalArgumentException", error.to_string());
            return JNI_FALSE;
        }
    };
    jni_guard(&mut env, || compact_search_index(&path).map(|_| ()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{Compression, write::DeflateEncoder};

    #[test]
    fn start_is_idempotent_and_shutdown_releases_the_port() {
        let root = tempfile::tempdir().unwrap();
        let payload = root.path().join("payload");
        start_engine(root.path().to_path_buf(), payload.clone()).unwrap();
        start_engine(root.path().to_path_buf(), payload.clone()).unwrap();
        stop_engine().unwrap();
        assert!(!payload.exists());
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, HTTP_PORT)).unwrap();
        drop(listener);
    }

    #[test]
    fn compact_search_index_is_reused() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("rutor.ls");
        let item = SearchItem {
            title: "Матрица / The Matrix (1999)".into(),
            names: BoundedNames(vec!["Matrix".into()]),
            magnet: format!("magnet:?xt=urn:btih:{}", "a".repeat(40)),
            hash: "a".repeat(40),
            year: 1999,
            seed: 42,
            ..SearchItem::default()
        };
        let mut encoder = DeflateEncoder::new(Vec::new(), Compression::fast());
        encoder
            .write_all(&serde_json::to_vec(&vec![item]).unwrap())
            .unwrap();
        std::fs::write(&source, encoder.finish().unwrap()).unwrap();

        let first: Vec<SearchItem> =
            serde_json::from_str(&search_index(&source, "matrix").unwrap()).unwrap();
        assert_eq!(first.len(), 1);
        let compact = source.with_extension("idx");
        let modified = compact.metadata().unwrap().modified().unwrap();
        let second: Vec<SearchItem> =
            serde_json::from_str(&search_index(&source, "матрица").unwrap()).unwrap();
        assert_eq!(second.len(), 1);
        assert_eq!(compact.metadata().unwrap().modified().unwrap(), modified);
    }
}
