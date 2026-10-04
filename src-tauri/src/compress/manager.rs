use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

use super::audio_encode::encode_audio;
use super::image_encode::encode_image;
use super::output::prepare_output_path;
use super::presets::{audio_preset, image_preset, video_preset};
use super::video_encode::encode_video;
use super::state::{apply_transition, should_continue, Transition, TransitionError};
use super::types::{
    CompressEvent, CompressStartRequest, JobInfo, JobStatus, MediaKind, COMPRESS_EVENT,
};

struct JobRecord {
    info: JobInfo,
    cancel: Arc<AtomicBool>,
}

struct Inner {
    next_id: u64,
    jobs: HashMap<String, JobRecord>,
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
        }
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

        let (job_id, info, cancel) = {
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
            (id, info, cancel)
        };

        let manager = self.clone();
        let source_path = request.source_path;
        let preset_id = request.preset_id;
        let media_kind = request.media_kind;
        thread::spawn(move || {
            run_job(
                manager,
                app,
                job_id,
                source_path,
                media_kind,
                preset_id,
                original_bytes,
                cancel,
            );
        });

        Ok(info)
    }

    pub fn cancel(&self, job_id: &str) -> Result<JobInfo, String> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "job manager lock poisoned".to_string())?;
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

fn resolve_output_ext(media_kind: &MediaKind, preset_id: &str) -> Result<&'static str, String> {
    match media_kind {
        MediaKind::Image => image_preset(preset_id)
            .map(|p| p.output_ext())
            .ok_or_else(|| format!("unknown image preset: {preset_id}")),
        MediaKind::Audio => audio_preset(preset_id)
            .map(|p| p.output_ext())
            .ok_or_else(|| format!("unknown audio preset: {preset_id}")),
        MediaKind::Video => video_preset(preset_id)
            .map(|p| p.output_ext())
            .ok_or_else(|| format!("unknown video preset: {preset_id}")),
        // Pdf encoder arrives in a later task — stub extension for now.
        MediaKind::Pdf => Ok("stub"),
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

    let output_ext = match resolve_output_ext(&media_kind, &preset_id) {
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
        MediaKind::Pdf => "stub",
    };
    emit(
        &app,
        CompressEvent::Log {
            job_id: job_id.clone(),
            message: format!("{encoder_label} encoder started ({preset_id})"),
        },
    );

    let source = PathBuf::from(&source_path);
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
            let result = encode_image(&source, &preset_id, &partial_path);
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
            );
            if result.is_ok() && !report_progress(96.0) {
                release_reserved();
                cancel_job(&manager, &app, job_id);
                return;
            }
            result
        }
        MediaKind::Pdf => run_stub_encode(&manager, &job_id, &cancel, &partial_path, report_progress),
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

/// Placeholder encoder for kinds without a real pipeline yet (pdf).
fn run_stub_encode(
    manager: &JobManager,
    job_id: &str,
    cancel: &AtomicBool,
    partial_path: &Path,
    mut report_progress: impl FnMut(f64) -> bool,
) -> Result<(), String> {
    let steps = [20.0_f64, 40.0, 60.0, 80.0];
    for percent in steps {
        if cancel.load(Ordering::SeqCst) || manager.is_cancel_requested(job_id) {
            return Err("cancelled".into());
        }
        if !report_progress(percent) {
            return Err("cancelled".into());
        }
        thread::sleep(Duration::from_millis(40));
    }

    let stub_bytes = b"fo-stub\n";
    fs::write(partial_path, stub_bytes).map_err(|e| format!("write failed: {e}"))?;
    Ok(())
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
}
