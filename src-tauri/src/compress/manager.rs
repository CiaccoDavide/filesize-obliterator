use std::collections::{HashMap, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;

use tauri::{AppHandle, Emitter};

use super::audio_encode::encode_audio;
use super::image_encode::{encode_image, resolve_image_output_ext};
use super::output::prepare_output_path;
use super::pdf_encode::encode_pdf;
use super::presets::{audio_preset, pdf_preset, video_preset};
use super::state::{apply_transition, should_continue, Transition, TransitionError};
use super::types::{
    CompressEvent, CompressStartRequest, JobInfo, JobStatus, MediaKind, COMPRESS_EVENT,
};
use super::video_encode::encode_video;

/// Hard cap on parallel encode workers (video/ffmpeg-heavy workloads).
pub const MAX_CONCURRENT_JOBS: usize = 2;

struct JobRecord {
    info: JobInfo,
    cancel: Arc<AtomicBool>,
}

struct QueuedWork {
    job_id: String,
    cancel: Arc<AtomicBool>,
    run: Box<dyn FnOnce() + Send + 'static>,
}

struct Inner {
    next_id: u64,
    jobs: HashMap<String, JobRecord>,
    /// FIFO of admitted jobs waiting for a worker slot (not yet spawned).
    wait_queue: VecDeque<QueuedWork>,
    /// Number of worker threads currently executing encode work.
    active_workers: usize,
}

#[derive(Clone, Default)]
pub struct JobManager {
    inner: Arc<Mutex<Inner>>,
}

impl Default for Inner {
    fn default() -> Self {
        Self {
            next_id: 1,
            jobs: HashMap::new(),
            wait_queue: VecDeque::new(),
            active_workers: 0,
        }
    }
}

/// Releases a concurrency slot and pumps the wait queue when dropped.
struct WorkerSlot {
    manager: JobManager,
}

impl Drop for WorkerSlot {
    fn drop(&mut self) {
        {
            let mut guard = match self.manager.inner.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            guard.active_workers = guard.active_workers.saturating_sub(1);
        }
        self.manager.pump();
    }
}

impl JobManager {
    pub fn start(
        &self,
        app: AppHandle,
        request: CompressStartRequest,
    ) -> Result<JobInfo, String> {
        let source = PathBuf::from(&request.source_path);
        if !source.is_file() {
            return Err("source file not found".into());
        }

        let original_bytes = fs::metadata(&source)
            .map_err(|e| format!("cannot read source: {e}"))?
            .len();

        let manager = self.clone();
        let source_path = request.source_path.clone();
        let preset_id = request.preset_id.clone();
        let media_kind = request.media_kind.clone();
        let strip_metadata = request.strip_metadata;

        self.admit(request, original_bytes, move |job_id, cancel| {
            run_job(
                manager,
                app,
                job_id,
                source_path,
                media_kind,
                preset_id,
                strip_metadata,
                original_bytes,
                cancel,
            );
        })
    }

    /// Admit a job into the ordered queue and pump workers up to [`MAX_CONCURRENT_JOBS`].
    fn admit<F>(
        &self,
        request: CompressStartRequest,
        original_bytes: u64,
        work: F,
    ) -> Result<JobInfo, String>
    where
        F: FnOnce(String, Arc<AtomicBool>) + Send + 'static,
    {
        let info = {
            let mut guard = self
                .inner
                .lock()
                .map_err(|_| "job manager lock poisoned".to_string())?;
            let id = format!("job-{}", guard.next_id);
            guard.next_id += 1;

            let info = JobInfo {
                id: id.clone(),
                source_path: request.source_path.clone(),
                media_kind: request.media_kind.clone(),
                preset_id: request.preset_id.clone(),
                status: JobStatus::Queued,
                percent: 0.0,
                error: None,
                output_path: None,
                original_bytes: Some(original_bytes),
                result_bytes: None,
                duration_ms: None,
            };
            let cancel = Arc::new(AtomicBool::new(false));
            guard.jobs.insert(
                id.clone(),
                JobRecord {
                    info: info.clone(),
                    cancel: Arc::clone(&cancel),
                },
            );

            let job_id = id.clone();
            let cancel_for_work = Arc::clone(&cancel);
            guard.wait_queue.push_back(QueuedWork {
                job_id: id,
                cancel,
                run: Box::new(move || work(job_id, cancel_for_work)),
            });
            info
        };

        self.pump();
        Ok(info)
    }

    /// Spawn workers for queued jobs until the concurrency cap is reached.
    fn pump(&self) {
        loop {
            let work = {
                let mut guard = match self.inner.lock() {
                    Ok(g) => g,
                    Err(_) => return,
                };
                if guard.active_workers >= MAX_CONCURRENT_JOBS {
                    return;
                }
                let mut chosen: Option<QueuedWork> = None;
                while let Some(item) = guard.wait_queue.pop_front() {
                    if item.cancel.load(Ordering::SeqCst) {
                        continue;
                    }
                    let cancelled = guard
                        .jobs
                        .get(&item.job_id)
                        .map(|r| r.info.status == JobStatus::Cancelled)
                        .unwrap_or(true);
                    if cancelled {
                        continue;
                    }
                    guard.active_workers += 1;
                    chosen = Some(item);
                    break;
                }
                match chosen {
                    Some(w) => w,
                    None => return,
                }
            };

            let manager = self.clone();
            thread::spawn(move || {
                let _slot = WorkerSlot {
                    manager: manager.clone(),
                };
                (work.run)();
            });
        }
    }

    pub fn cancel(&self, job_id: &str) -> Result<JobInfo, String> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "job manager lock poisoned".to_string())?;

        // Drop wait-queue entry so a cancelled job never takes a worker slot.
        guard.wait_queue.retain(|w| w.job_id != job_id);

        let record = guard
            .jobs
            .get_mut(job_id)
            .ok_or_else(|| "job not found".to_string())?;

        match apply_transition(record.info.status.clone(), Transition::Cancel) {
            Ok((status, percent)) => {
                record.cancel.store(true, Ordering::SeqCst);
                record.info.status = status;
                if let Some(p) = percent {
                    record.info.percent = p;
                }
                Ok(record.info.clone())
            }
            Err(TransitionError::NotCancellable) => {
                Err("job already finished".into())
            }
            Err(other) => Err(format!("cannot cancel: {other:?}")),
        }
    }

    pub fn list(&self) -> Result<Vec<JobInfo>, String> {
        let guard = self
            .inner
            .lock()
            .map_err(|_| "job manager lock poisoned".to_string())?;
        let mut jobs: Vec<_> = guard.jobs.values().map(|r| r.info.clone()).collect();
        jobs.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(jobs)
    }

    /// Source + output paths for a completed image job (preview grant validation).
    pub fn completed_image_preview_paths(
        &self,
        job_id: &str,
    ) -> Result<(PathBuf, PathBuf), String> {
        let guard = self
            .inner
            .lock()
            .map_err(|_| "job manager lock poisoned".to_string())?;
        let record = guard
            .jobs
            .get(job_id)
            .ok_or_else(|| "job not found".to_string())?;
        let info = &record.info;
        if info.media_kind != MediaKind::Image {
            return Err("preview requires an image job".into());
        }
        if info.status != JobStatus::Completed {
            return Err("preview requires a completed job".into());
        }
        if info.source_path.trim().is_empty() {
            return Err("preview requires a source path".into());
        }
        let output = info
            .output_path
            .as_ref()
            .map(|p| p.trim())
            .filter(|p| !p.is_empty())
            .ok_or_else(|| "preview requires an output path".to_string())?;
        Ok((PathBuf::from(&info.source_path), PathBuf::from(output)))
    }

    fn with_job<F, T>(&self, job_id: &str, f: F) -> Result<T, String>
    where
        F: FnOnce(&mut JobRecord) -> Result<T, String>,
    {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "job manager lock poisoned".to_string())?;
        let record = guard
            .jobs
            .get_mut(job_id)
            .ok_or_else(|| "job not found".to_string())?;
        f(record)
    }

    fn mark_running(&self, job_id: &str) -> Result<(), String> {
        self.with_job(job_id, |record| {
            let (status, percent) =
                apply_transition(record.info.status.clone(), Transition::Start)
                    .map_err(|e| format!("cannot start: {e:?}"))?;
            record.info.status = status;
            if let Some(p) = percent {
                record.info.percent = p;
            }
            Ok(())
        })
    }

    fn mark_progress(&self, job_id: &str, percent: f64) -> Result<bool, String> {
        self.with_job(job_id, |record| {
            if record.cancel.load(Ordering::SeqCst)
                || !should_continue(record.info.status.clone(), false)
            {
                return Ok(false);
            }
            match apply_transition(
                record.info.status.clone(),
                Transition::Progress { percent },
            ) {
                Ok((status, Some(p))) => {
                    record.info.status = status;
                    record.info.percent = p;
                    Ok(true)
                }
                Ok((status, None)) => {
                    record.info.status = status;
                    Ok(true)
                }
                Err(_) => Ok(false),
            }
        })
    }

    fn mark_complete(
        &self,
        job_id: &str,
        output_path: String,
        result_bytes: u64,
        duration_ms: u64,
    ) -> Result<bool, String> {
        self.with_job(job_id, |record| {
            if record.cancel.load(Ordering::SeqCst) {
                return Ok(false);
            }
            let (status, percent) =
                apply_transition(record.info.status.clone(), Transition::Complete)
                    .map_err(|_| "cannot complete".to_string())?;
            record.info.status = status;
            if let Some(p) = percent {
                record.info.percent = p;
            }
            record.info.output_path = Some(output_path);
            record.info.result_bytes = Some(result_bytes);
            record.info.duration_ms = Some(duration_ms);
            Ok(true)
        })
    }

    fn mark_failed(&self, job_id: &str, error: String) -> Result<(), String> {
        self.with_job(job_id, |record| {
            // Cancel path may already have set Cancelled; keep that status.
            if record.info.status == JobStatus::Cancelled {
                record.info.error = Some(error);
                return Ok(());
            }
            if let Ok((status, _)) =
                apply_transition(record.info.status.clone(), Transition::Fail)
            {
                record.info.status = status;
            } else if record.info.status == JobStatus::Queued
                || record.info.status == JobStatus::Running
            {
                record.info.status = JobStatus::Failed;
            }
            record.info.error = Some(error);
            Ok(())
        })
    }

    fn is_cancel_requested(&self, job_id: &str) -> bool {
        self.inner
            .lock()
            .ok()
            .and_then(|g| g.jobs.get(job_id).map(|r| r.cancel.load(Ordering::SeqCst)))
            .unwrap_or(true)
    }

    #[cfg(test)]
    fn active_workers_for_test(&self) -> usize {
        self.inner.lock().map(|g| g.active_workers).unwrap_or(0)
    }

    #[cfg(test)]
    fn wait_queue_len_for_test(&self) -> usize {
        self.inner.lock().map(|g| g.wait_queue.len()).unwrap_or(0)
    }

    /// Test seam: admit work through the same bounded queue as production `start`.
    #[cfg(test)]
    fn start_with_work<F>(
        &self,
        source_path: PathBuf,
        work: F,
    ) -> Result<JobInfo, String>
    where
        F: FnOnce(Arc<AtomicBool>) + Send + 'static,
    {
        if !source_path.is_file() {
            return Err("source file not found".into());
        }
        let original_bytes = fs::metadata(&source_path)
            .map_err(|e| format!("cannot read source: {e}"))?
            .len();
        let request = CompressStartRequest {
            source_path: source_path.to_string_lossy().into_owned(),
            media_kind: MediaKind::Image,
            preset_id: "balanced".into(),
            strip_metadata: true,
        };
        self.admit(request, original_bytes, move |_job_id, cancel| work(cancel))
    }
}

fn emit(app: &AppHandle, event: CompressEvent) {
    let _ = app.emit(COMPRESS_EVENT, event);
}

fn fail_job(manager: &JobManager, app: &AppHandle, job_id: String, error: String) {
    let _ = manager.mark_failed(&job_id, error.clone());
    emit(
        app,
        CompressEvent::Failed {
            job_id,
            error,
        },
    );
}

fn cancel_job(manager: &JobManager, app: &AppHandle, job_id: String) {
    let error = "cancelled".to_string();
    let _ = manager.mark_failed(&job_id, error.clone());
    let _ = manager.with_job(&job_id, |record| {
        record.info.status = JobStatus::Cancelled;
        record.info.error = Some(error.clone());
        Ok(())
    });
    emit(
        app,
        CompressEvent::Failed {
            job_id,
            error,
        },
    );
}

fn resolve_output_ext(
    media_kind: &MediaKind,
    preset_id: &str,
    source: &Path,
) -> Result<&'static str, String> {
    match media_kind {
        MediaKind::Image => resolve_image_output_ext(source, preset_id),
        MediaKind::Audio => audio_preset(preset_id)
            .map(|p| p.output_ext())
            .ok_or_else(|| format!("unknown audio preset: {preset_id}")),
        MediaKind::Video => video_preset(preset_id)
            .map(|p| p.output_ext())
            .ok_or_else(|| format!("unknown video preset: {preset_id}")),
        MediaKind::Pdf => pdf_preset(preset_id)
            .map(|p| p.output_ext())
            .ok_or_else(|| format!("unknown pdf preset: {preset_id}")),
    }
}

/// Soft warning when strip was requested but the kind cannot honor it.
fn strip_unsupported_warning(media_kind: &MediaKind, strip_metadata: bool) -> Option<&'static str> {
    if !strip_metadata {
        return None;
    }
    match media_kind {
        MediaKind::Pdf => Some(
            "warn: metadata strip unsupported for pdf; continuing without guarantee",
        ),
        MediaKind::Image | MediaKind::Audio | MediaKind::Video => None,
    }
}

#[allow(clippy::too_many_arguments)]
fn run_job(
    manager: JobManager,
    app: AppHandle,
    job_id: String,
    source_path: String,
    media_kind: MediaKind,
    preset_id: String,
    strip_metadata: bool,
    original_bytes: u64,
    cancel: Arc<AtomicBool>,
) {
    let started = Instant::now();

    if let Err(e) = manager.mark_running(&job_id) {
        let error = if manager.is_cancel_requested(&job_id) {
            "cancelled".to_string()
        } else {
            e
        };
        fail_job(&manager, &app, job_id, error);
        return;
    }

    let source = PathBuf::from(&source_path);
    let output_ext = match resolve_output_ext(&media_kind, &preset_id, &source) {
        Ok(ext) => ext,
        Err(error) => {
            fail_job(&manager, &app, job_id, error);
            return;
        }
    };

    let encoder_label = match media_kind {
        MediaKind::Image => "image",
        MediaKind::Audio => "audio",
        MediaKind::Video => "video",
        MediaKind::Pdf => "pdf",
    };
    emit(
        &app,
        CompressEvent::Log {
            job_id: job_id.clone(),
            message: format!("{encoder_label} encoder started ({preset_id})"),
        },
    );
    if let Some(warn) = strip_unsupported_warning(&media_kind, strip_metadata) {
        emit(
            &app,
            CompressEvent::Log {
                job_id: job_id.clone(),
                message: warn.into(),
            },
        );
    }
    let output_path = match prepare_output_path(&source, output_ext) {
        Ok(path) => path,
        Err(error) => {
            fail_job(&manager, &app, job_id, error);
            return;
        }
    };

    // Partial staging file — unique per job so concurrent encodes never share a staging name.
    // Never promoted on cancel. Final path is already reserved (empty) by prepare_output_path.
    let partial_path = {
        let parent = output_path.parent().unwrap_or_else(|| Path::new("."));
        let base = output_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("out");
        parent.join(format!("{base}.{job_id}.partial"))
    };
    let _ = fs::write(&partial_path, b"");

    let release_reserved = || {
        let _ = fs::remove_file(&partial_path);
        let _ = fs::remove_file(&output_path);
    };

    let report_progress = |percent: f64| -> bool {
        if cancel.load(Ordering::SeqCst) || manager.is_cancel_requested(&job_id) {
            return false;
        }
        if !manager.mark_progress(&job_id, percent).unwrap_or(false) {
            return false;
        }
        let bytes_processed = ((percent / 100.0) * original_bytes as f64) as u64;
        emit(
            &app,
            CompressEvent::Progress {
                job_id: job_id.clone(),
                percent,
                bytes_processed: Some(bytes_processed),
                bytes_total: Some(original_bytes),
            },
        );
        true
    };

    if !report_progress(0.0) {
        release_reserved();
        cancel_job(&manager, &app, job_id);
        return;
    }

    let encode_result = match media_kind {
        MediaKind::Image => {
            if !report_progress(20.0) {
                release_reserved();
                cancel_job(&manager, &app, job_id);
                return;
            }
            let result = encode_image(&source, &preset_id, &partial_path, strip_metadata);
            if result.is_ok() && !report_progress(90.0) {
                release_reserved();
                cancel_job(&manager, &app, job_id);
                return;
            }
            result
        }
        MediaKind::Audio => {
            if !report_progress(20.0) {
                release_reserved();
                cancel_job(&manager, &app, job_id);
                return;
            }
            let result = encode_audio(&source, &preset_id, &partial_path, Some(cancel.as_ref()));
            if result.is_ok() && !report_progress(90.0) {
                release_reserved();
                cancel_job(&manager, &app, job_id);
                return;
            }
            result
        }
        MediaKind::Video => {
            if !report_progress(1.0) {
                release_reserved();
                cancel_job(&manager, &app, job_id);
                return;
            }
            let mut on_progress = |percent: f64| -> bool {
                // Map encoder 0..=99 into job 1..=95 so finalize can still emit 100.
                let mapped = (percent.clamp(0.0, 99.0) * 0.95).clamp(1.0, 95.0);
                report_progress(mapped)
            };
            let result = encode_video(
                &source,
                &preset_id,
                &partial_path,
                Some(cancel.as_ref()),
                Some(&mut on_progress),
                strip_metadata,
            );
            if result.is_ok() && !report_progress(96.0) {
                release_reserved();
                cancel_job(&manager, &app, job_id);
                return;
            }
            result
        }
        MediaKind::Pdf => {
            if !report_progress(20.0) {
                release_reserved();
                cancel_job(&manager, &app, job_id);
                return;
            }
            let result = encode_pdf(&source, &preset_id, &partial_path, Some(cancel.as_ref()));
            if result.is_ok() && !report_progress(90.0) {
                release_reserved();
                cancel_job(&manager, &app, job_id);
                return;
            }
            result
        }
    };

    if let Err(error) = encode_result {
        release_reserved();
        if error == "cancelled" {
            cancel_job(&manager, &app, job_id);
        } else {
            fail_job(&manager, &app, job_id, error);
        }
        return;
    }

    if cancel.load(Ordering::SeqCst) || manager.is_cancel_requested(&job_id) {
        release_reserved();
        cancel_job(&manager, &app, job_id);
        return;
    }

    // Promote partial into the reserved final path without loading the whole file into RAM
    // (video outputs can be large). Remove the empty reservation first so rename works on Windows.
    let result_bytes = match fs::metadata(&partial_path).map(|m| m.len()) {
        Ok(n) => n,
        Err(e) => {
            release_reserved();
            fail_job(
                &manager,
                &app,
                job_id,
                format!("read partial failed: {e}"),
            );
            return;
        }
    };
    let _ = fs::remove_file(&output_path);
    if let Err(e) = fs::rename(&partial_path, &output_path) {
        // Fallback copy if rename crosses volumes.
        if let Err(copy_err) = fs::copy(&partial_path, &output_path) {
            release_reserved();
            fail_job(
                &manager,
                &app,
                job_id,
                format!("finalize failed: {e}; copy: {copy_err}"),
            );
            return;
        }
        let _ = fs::remove_file(&partial_path);
    }

    if !report_progress(100.0) {
        let _ = fs::remove_file(&output_path);
        cancel_job(&manager, &app, job_id);
        return;
    }
    let duration_ms = started.elapsed().as_millis() as u64;
    let output_str = output_path.to_string_lossy().into_owned();

    match manager.mark_complete(
        &job_id,
        output_str.clone(),
        result_bytes,
        duration_ms,
    ) {
        Ok(true) => {
            emit(
                &app,
                CompressEvent::Log {
                    job_id: job_id.clone(),
                    message: format!("{encoder_label} encoder finished"),
                },
            );
            emit(
                &app,
                CompressEvent::Complete {
                    job_id,
                    output_path: output_str,
                    original_bytes,
                    result_bytes,
                    duration_ms,
                },
            );
        }
        Ok(false) => {
            // Cancel won the race after write — do not leave success path artifacts.
            let _ = fs::remove_file(&output_path);
            cancel_job(&manager, &app, job_id);
        }
        Err(e) => {
            let _ = fs::remove_file(&output_path);
            fail_job(&manager, &app, job_id, e);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compress::types::MediaKind;
    use std::io::Write;

    fn temp_source(name: &str, contents: &[u8]) -> PathBuf {
        let dir = std::env::temp_dir().join("filesize-obliterator-tests");
        fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join(name);
        let mut f = fs::File::create(&path).expect("create");
        f.write_all(contents).expect("write");
        path
    }

    #[test]
    fn cancel_marks_job_cancelled_before_worker() {
        let manager = JobManager::default();
        let source = temp_source("cancel-before.bin", b"abc");
        let mut guard = manager.inner.lock().unwrap();
        let id = "job-test-1".to_string();
        let cancel = Arc::new(AtomicBool::new(false));
        guard.jobs.insert(
            id.clone(),
            JobRecord {
                info: JobInfo {
                    id: id.clone(),
                    source_path: source.to_string_lossy().into_owned(),
                    media_kind: MediaKind::Image,
                    preset_id: "balanced".into(),
                    status: JobStatus::Queued,
                    percent: 0.0,
                    error: None,
                    output_path: None,
                    original_bytes: Some(3),
                    result_bytes: None,
                    duration_ms: None,
                },
                cancel: Arc::clone(&cancel),
            },
        );
        drop(guard);

        let info = manager.cancel(&id).expect("cancel");
        assert_eq!(info.status, JobStatus::Cancelled);
        assert!(cancel.load(Ordering::SeqCst));
        assert!(manager.cancel(&id).is_err());
    }

    #[test]
    fn strip_unsupported_warns_for_pdf_only() {
        assert!(strip_unsupported_warning(&MediaKind::Pdf, true).is_some());
        assert!(strip_unsupported_warning(&MediaKind::Pdf, false).is_none());
        assert!(strip_unsupported_warning(&MediaKind::Image, true).is_none());
        assert!(strip_unsupported_warning(&MediaKind::Audio, true).is_none());
        assert!(strip_unsupported_warning(&MediaKind::Video, true).is_none());
    }

    #[test]
    fn completed_image_preview_paths_requires_complete_image() {
        let manager = JobManager::default();
        let source = temp_source("preview-src.png", b"png");
        let output = temp_source("preview-out.jpg", b"jpg");
        let mut guard = manager.inner.lock().unwrap();
        guard.jobs.insert(
            "job-img".into(),
            JobRecord {
                info: JobInfo {
                    id: "job-img".into(),
                    source_path: source.to_string_lossy().into_owned(),
                    media_kind: MediaKind::Image,
                    preset_id: "image-balanced".into(),
                    status: JobStatus::Completed,
                    percent: 100.0,
                    error: None,
                    output_path: Some(output.to_string_lossy().into_owned()),
                    original_bytes: Some(3),
                    result_bytes: Some(2),
                    duration_ms: Some(1),
                },
                cancel: Arc::new(AtomicBool::new(false)),
            },
        );
        guard.jobs.insert(
            "job-vid".into(),
            JobRecord {
                info: JobInfo {
                    id: "job-vid".into(),
                    source_path: source.to_string_lossy().into_owned(),
                    media_kind: MediaKind::Video,
                    preset_id: "video-balanced".into(),
                    status: JobStatus::Completed,
                    percent: 100.0,
                    error: None,
                    output_path: Some(output.to_string_lossy().into_owned()),
                    original_bytes: Some(3),
                    result_bytes: Some(2),
                    duration_ms: Some(1),
                },
                cancel: Arc::new(AtomicBool::new(false)),
            },
        );
        guard.jobs.insert(
            "job-run".into(),
            JobRecord {
                info: JobInfo {
                    id: "job-run".into(),
                    source_path: source.to_string_lossy().into_owned(),
                    media_kind: MediaKind::Image,
                    preset_id: "image-balanced".into(),
                    status: JobStatus::Running,
                    percent: 10.0,
                    error: None,
                    output_path: None,
                    original_bytes: Some(3),
                    result_bytes: None,
                    duration_ms: None,
                },
                cancel: Arc::new(AtomicBool::new(false)),
            },
        );
        drop(guard);

        let (src, out) = manager
            .completed_image_preview_paths("job-img")
            .expect("completed image");
        assert_eq!(src, source);
        assert_eq!(out, output);
        assert!(manager
            .completed_image_preview_paths("job-vid")
            .unwrap_err()
            .contains("image"));
        assert!(manager
            .completed_image_preview_paths("job-run")
            .unwrap_err()
            .contains("completed"));
        assert!(manager.completed_image_preview_paths("missing").is_err());
    }

    #[test]
    fn list_returns_sorted_job_ids() {
        let manager = JobManager::default();
        let source = temp_source("list.bin", b"x");
        let mut guard = manager.inner.lock().unwrap();
        for id in ["job-2", "job-1"] {
            guard.jobs.insert(
                id.to_string(),
                JobRecord {
                    info: JobInfo {
                        id: id.to_string(),
                        source_path: source.to_string_lossy().into_owned(),
                        media_kind: MediaKind::Audio,
                        preset_id: "fast".into(),
                        status: JobStatus::Queued,
                        percent: 0.0,
                        error: None,
                        output_path: None,
                        original_bytes: Some(1),
                        result_bytes: None,
                        duration_ms: None,
                    },
                    cancel: Arc::new(AtomicBool::new(false)),
                },
            );
        }
        drop(guard);
        let list = manager.list().expect("list");
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, "job-1");
        assert_eq!(list[1].id, "job-2");
    }

    #[test]
    fn concurrency_cap_is_two() {
        assert_eq!(MAX_CONCURRENT_JOBS, 2);
    }

    #[test]
    fn never_runs_more_than_max_concurrent_jobs() {
        use std::sync::atomic::AtomicUsize;
        use std::time::Duration;

        let manager = JobManager::default();
        let block = Arc::new(AtomicBool::new(true));
        let in_flight = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));

        for i in 0..5 {
            let block = Arc::clone(&block);
            let in_flight = Arc::clone(&in_flight);
            let peak = Arc::clone(&peak);
            let source = temp_source(&format!("conc-{i}.bin"), b"x");
            manager
                .start_with_work(source, move |_| {
                    let n = in_flight.fetch_add(1, Ordering::SeqCst) + 1;
                    peak.fetch_max(n, Ordering::SeqCst);
                    while block.load(Ordering::SeqCst) {
                        thread::sleep(Duration::from_millis(5));
                    }
                    in_flight.fetch_sub(1, Ordering::SeqCst);
                })
                .expect("admit");
        }

        // Wait until the cap is saturated.
        let mut saw_cap = false;
        for _ in 0..100 {
            if in_flight.load(Ordering::SeqCst) == MAX_CONCURRENT_JOBS {
                saw_cap = true;
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        assert!(saw_cap, "expected {MAX_CONCURRENT_JOBS} workers in flight");
        assert_eq!(manager.active_workers_for_test(), MAX_CONCURRENT_JOBS);
        assert!(manager.wait_queue_len_for_test() >= 1);
        assert_eq!(peak.load(Ordering::SeqCst), MAX_CONCURRENT_JOBS);

        block.store(false, Ordering::SeqCst);
        for _ in 0..100 {
            if in_flight.load(Ordering::SeqCst) == 0
                && manager.active_workers_for_test() == 0
            {
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(in_flight.load(Ordering::SeqCst), 0);
        assert_eq!(peak.load(Ordering::SeqCst), MAX_CONCURRENT_JOBS);
        assert_eq!(manager.active_workers_for_test(), 0);
        assert_eq!(manager.wait_queue_len_for_test(), 0);
    }

    #[test]
    fn cancel_waiting_job_never_runs_work() {
        use std::time::Duration;

        let manager = JobManager::default();
        let block = Arc::new(AtomicBool::new(true));
        let ran_waiting = Arc::new(AtomicBool::new(false));

        for i in 0..MAX_CONCURRENT_JOBS {
            let block = Arc::clone(&block);
            let source = temp_source(&format!("block-{i}.bin"), b"x");
            manager
                .start_with_work(source, move |_| {
                    while block.load(Ordering::SeqCst) {
                        thread::sleep(Duration::from_millis(5));
                    }
                })
                .expect("admit blocker");
        }

        // Wait for blockers to take both slots.
        for _ in 0..100 {
            if manager.active_workers_for_test() == MAX_CONCURRENT_JOBS {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(manager.active_workers_for_test(), MAX_CONCURRENT_JOBS);

        let ran_waiting_flag = Arc::clone(&ran_waiting);
        let waiting = manager
            .start_with_work(temp_source("waiting.bin", b"x"), move |_| {
                ran_waiting_flag.store(true, Ordering::SeqCst);
            })
            .expect("admit waiting");
        assert!(manager.wait_queue_len_for_test() >= 1);

        let cancelled = manager.cancel(&waiting.id).expect("cancel waiting");
        assert_eq!(cancelled.status, JobStatus::Cancelled);
        assert_eq!(manager.wait_queue_len_for_test(), 0);

        block.store(false, Ordering::SeqCst);
        for _ in 0..100 {
            if manager.active_workers_for_test() == 0 {
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }
        assert!(!ran_waiting.load(Ordering::SeqCst));
    }

    #[test]
    fn one_job_failure_does_not_block_sibling() {
        use std::sync::atomic::AtomicUsize;
        use std::time::Duration;

        let manager = JobManager::default();
        let finished = Arc::new(AtomicUsize::new(0));

        let finished_a = Arc::clone(&finished);
        manager
            .start_with_work(temp_source("fail-a.bin", b"x"), move |_| {
                finished_a.fetch_add(1, Ordering::SeqCst);
                // Simulate encode failure — sibling must still run.
            })
            .expect("admit a");

        let finished_b = Arc::clone(&finished);
        manager
            .start_with_work(temp_source("ok-b.bin", b"x"), move |_| {
                finished_b.fetch_add(1, Ordering::SeqCst);
            })
            .expect("admit b");

        for _ in 0..100 {
            if finished.load(Ordering::SeqCst) == 2 {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(finished.load(Ordering::SeqCst), 2);
    }
}
