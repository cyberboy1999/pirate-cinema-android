use std::{
    fs::OpenOptions,
    io::IoSlice,
    path::{Path, PathBuf},
};

#[cfg(target_os = "android")]
use std::sync::{Arc, Mutex};

use anyhow::Context;
use tracing::warn;

#[cfg(target_os = "android")]
use librqbit_core::lengths::{Lengths, ValidPieceIndex};

#[cfg(target_os = "android")]
use crate::type_aliases::FileInfos;

use crate::{
    storage::{StorageFactoryExt, filesystem::opened_file::OurFileExt},
    torrent_state::{ManagedTorrentShared, TorrentMetadata},
};

use crate::storage::{StorageFactory, TorrentStorage};

use super::opened_file::OpenedFile;
#[cfg(target_os = "android")]
use super::opened_file::punch_hole;

#[cfg(target_os = "android")]
const ANDROID_CACHE_CAPACITY: u64 = 384 * 1024 * 1024;

#[cfg(target_os = "android")]
#[derive(Clone, Copy, Default)]
struct CachePiece {
    complete: bool,
    accessed: u64,
}

#[cfg(target_os = "android")]
struct CacheInner {
    pieces: Vec<CachePiece>,
    filled: u64,
    clock: u64,
    evicted: Vec<ValidPieceIndex>,
}

#[cfg(target_os = "android")]
struct AndroidCache {
    lengths: Lengths,
    file_infos: FileInfos,
    inner: Mutex<CacheInner>,
    eviction: Mutex<()>,
}

#[cfg(target_os = "android")]
impl AndroidCache {
    fn new(metadata: &TorrentMetadata) -> Self {
        Self {
            lengths: *metadata.lengths(),
            file_infos: metadata.file_infos.clone(),
            inner: Mutex::new(CacheInner {
                pieces: vec![CachePiece::default(); metadata.lengths().total_pieces() as usize],
                filled: 0,
                clock: 0,
                evicted: Vec::new(),
            }),
            eviction: Mutex::new(()),
        }
    }

    fn touch(&self, file_id: usize, offset: u64, len: usize) {
        if len == 0 {
            return;
        }
        let Some(file) = self.file_infos.get(file_id) else {
            return;
        };
        let start = file.offset_in_torrent + offset;
        let end = start.saturating_add(len as u64 - 1);
        let piece_len = self.lengths.default_piece_length() as u64;
        let mut inner = self.inner.lock().unwrap();
        inner.clock += 1;
        let now = inner.clock;
        for raw in (start / piece_len)..=(end / piece_len) {
            if let Some(piece) = inner.pieces.get_mut(raw as usize) {
                piece.accessed = now;
            }
        }
    }

    fn complete(&self, id: ValidPieceIndex) {
        let mut inner = self.inner.lock().unwrap();
        inner.clock += 1;
        let now = inner.clock;
        let piece = &mut inner.pieces[id.get_usize()];
        piece.accessed = now;
        if !piece.complete {
            piece.complete = true;
            inner.filled += self.lengths.piece_length(id) as u64;
        }
    }

    fn oldest(&self, keep: ValidPieceIndex) -> Option<ValidPieceIndex> {
        let inner = self.inner.lock().unwrap();
        if inner.filled <= ANDROID_CACHE_CAPACITY {
            return None;
        }
        inner
            .pieces
            .iter()
            .enumerate()
            .filter(|(id, piece)| piece.complete && *id != keep.get_usize())
            .min_by_key(|(_, piece)| piece.accessed)
            .and_then(|(id, _)| self.lengths.validate_piece_index(id as u32))
    }

    fn evicted(&self, id: ValidPieceIndex) {
        let mut inner = self.inner.lock().unwrap();
        let piece = &mut inner.pieces[id.get_usize()];
        if piece.complete {
            piece.complete = false;
            inner.filled = inner
                .filled
                .saturating_sub(self.lengths.piece_length(id) as u64);
            inner.evicted.push(id);
        }
    }

    fn take_evicted(&self) -> Vec<ValidPieceIndex> {
        std::mem::take(&mut self.inner.lock().unwrap().evicted)
    }
}

#[derive(Default, Clone, Copy)]
pub struct FilesystemStorageFactory {}

impl StorageFactory for FilesystemStorageFactory {
    type Storage = FilesystemStorage;

    fn create(
        &self,
        shared: &ManagedTorrentShared,
        _metadata: &TorrentMetadata,
    ) -> anyhow::Result<FilesystemStorage> {
        Ok(FilesystemStorage {
            output_folder: shared.options.output_folder.clone(),
            opened_files: Default::default(),
            #[cfg(target_os = "android")]
            android_cache: Arc::new(AndroidCache::new(_metadata)),
        })
    }

    fn clone_box(&self) -> crate::storage::BoxStorageFactory {
        self.boxed()
    }
}

pub struct FilesystemStorage {
    pub(crate) output_folder: PathBuf,
    pub(crate) opened_files: Vec<OpenedFile>,
    #[cfg(target_os = "android")]
    android_cache: Arc<AndroidCache>,
}

impl FilesystemStorage {
    #[allow(dead_code)]
    pub(crate) fn take_fs(&self) -> anyhow::Result<Self> {
        Ok(Self {
            opened_files: self
                .opened_files
                .iter()
                .map(|f| f.take_clone())
                .collect::<anyhow::Result<Vec<_>>>()?,
            output_folder: self.output_folder.clone(),
            #[cfg(target_os = "android")]
            android_cache: self.android_cache.clone(),
        })
    }

    #[cfg(target_os = "android")]
    fn punch_piece(&self, id: ValidPieceIndex) -> anyhow::Result<()> {
        let start = id.get() as u64 * self.android_cache.lengths.default_piece_length() as u64;
        let end = start + self.android_cache.lengths.piece_length(id) as u64;
        for (file_id, file) in self.android_cache.file_infos.iter().enumerate() {
            if file.attrs.padding {
                continue;
            }
            let file_start = file.offset_in_torrent;
            let file_end = file_start + file.len;
            let overlap_start = start.max(file_start);
            let overlap_end = end.min(file_end);
            if overlap_start < overlap_end {
                let opened = self.opened_files.get(file_id).context("no such file")?;
                let guard = opened.lock_read()?;
                punch_hole(
                    &guard,
                    overlap_start - file_start,
                    overlap_end - overlap_start,
                )?;
            }
        }
        Ok(())
    }
}

impl TorrentStorage for FilesystemStorage {
    fn pread_exact(&self, file_id: usize, offset: u64, buf: &mut [u8]) -> anyhow::Result<()> {
        let result = self
            .opened_files
            .get(file_id)
            .context("no such file")?
            .lock_read()?
            .pread_exact(offset, buf);
        #[cfg(target_os = "android")]
        if result.is_ok() {
            self.android_cache.touch(file_id, offset, buf.len());
        }
        result
    }

    fn pwrite_all(&self, file_id: usize, offset: u64, buf: &[u8]) -> anyhow::Result<()> {
        let of = self.opened_files.get(file_id).context("no such file")?;
        #[cfg(windows)]
        return of.try_mark_sparse()?.pwrite_all(offset, buf);
        #[cfg(not(windows))]
        {
            let result = of.lock_read()?.pwrite_all(offset, buf);
            #[cfg(target_os = "android")]
            if result.is_ok() {
                self.android_cache.touch(file_id, offset, buf.len());
            }
            return result;
        }
    }

    fn pwrite_all_vectored(
        &self,
        file_id: usize,
        offset: u64,
        bufs: [IoSlice<'_>; 2],
    ) -> anyhow::Result<usize> {
        let of = self.opened_files.get(file_id).context("no such file")?;
        #[cfg(windows)]
        return of.try_mark_sparse()?.pwrite_all_vectored(offset, bufs);
        #[cfg(not(windows))]
        {
            let len = bufs.iter().map(|buf| buf.len()).sum();
            let result = of.lock_read()?.pwrite_all_vectored(offset, bufs);
            #[cfg(target_os = "android")]
            if result.is_ok() {
                self.android_cache.touch(file_id, offset, len);
            }
            return result;
        }
    }

    fn remove_file(&self, _file_id: usize, filename: &Path) -> anyhow::Result<()> {
        Ok(std::fs::remove_file(self.output_folder.join(filename))?)
    }

    #[cfg(not(target_os = "android"))]
    fn ensure_file_length(&self, file_id: usize, len: u64) -> anyhow::Result<()> {
        let f = &self.opened_files.get(file_id).context("no such file")?;
        #[cfg(windows)]
        f.try_mark_sparse()?;
        Ok(f.lock_read()?.set_len(len)?)
    }

    #[cfg(target_os = "android")]
    fn ensure_file_length(&self, _file_id: usize, _len: u64) -> anyhow::Result<()> {
        // Android/F2FS may synchronously reserve the whole logical torrent here. Let positioned
        // writes grow a sparse cache file on demand so playback starts without filling storage.
        Ok(())
    }

    fn take(&self) -> anyhow::Result<Box<dyn TorrentStorage>> {
        Ok(Box::new(Self {
            opened_files: self
                .opened_files
                .iter()
                .map(|f| f.take_clone())
                .collect::<anyhow::Result<Vec<_>>>()?,
            output_folder: self.output_folder.clone(),
            #[cfg(target_os = "android")]
            android_cache: self.android_cache.clone(),
        }))
    }

    fn remove_directory_if_empty(&self, path: &Path) -> anyhow::Result<()> {
        let path = self.output_folder.join(path);
        if !path.is_dir() {
            anyhow::bail!("cannot remove dir: {path:?} is not a directory")
        }
        if std::fs::read_dir(&path)?.count() == 0 {
            std::fs::remove_dir(&path).with_context(|| format!("error removing {path:?}"))
        } else {
            warn!("did not remove {path:?} as it was not empty");
            Ok(())
        }
    }

    fn init(
        &mut self,
        shared: &ManagedTorrentShared,
        metadata: &TorrentMetadata,
    ) -> anyhow::Result<()> {
        let mut files = Vec::<OpenedFile>::new();
        for file_details in metadata.file_infos.iter() {
            let mut full_path = self.output_folder.clone();
            let relative_path = &file_details.relative_filename;
            full_path.push(relative_path);

            if file_details.attrs.padding {
                files.push(OpenedFile::new_dummy());
                continue;
            };
            std::fs::create_dir_all(full_path.parent().context("bug: no parent")?)?;
            let f = if shared.options.allow_overwrite {
                OpenOptions::new()
                    .create(true)
                    .truncate(false)
                    .read(true)
                    .write(true)
                    .open(&full_path)
                    .with_context(|| format!("error opening {full_path:?} in read/write mode"))?
            } else {
                // create_new does not seem to work with read(true), so calling this twice.
                OpenOptions::new()
                    .create_new(true)
                    .write(true)
                    .open(&full_path)
                    .with_context(|| {
                        format!(
                            "error creating a new file (because allow_overwrite = false) {:?}",
                            full_path
                        )
                    })?;
                OpenOptions::new().read(true).write(true).open(&full_path)?
            };
            files.push(OpenedFile::new(full_path.clone(), f));
        }

        self.opened_files = files;
        Ok(())
    }

    #[cfg(target_os = "android")]
    fn on_piece_completed(&self, piece_index: ValidPieceIndex) -> anyhow::Result<()> {
        self.android_cache.complete(piece_index);
        let cache = self.android_cache.clone();
        let _eviction = cache.eviction.lock().unwrap();
        while let Some(oldest) = cache.oldest(piece_index) {
            self.punch_piece(oldest)?;
            cache.evicted(oldest);
        }
        Ok(())
    }

    #[cfg(target_os = "android")]
    fn take_evicted_pieces(&self) -> Vec<ValidPieceIndex> {
        self.android_cache.take_evicted()
    }
}
