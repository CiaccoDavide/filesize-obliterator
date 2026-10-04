use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MediaKind {
    Image,
    Audio,
    Video,
    Pdf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum JobStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompressStartRequest {
    pub source_path: String,
    pub media_kind: MediaKind,
    pub preset_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JobInfo {
    pub id: String,
    pub source_path: String,
    pub media_kind: MediaKind,
    pub preset_id: String,
    pub status: JobStatus,
    pub percent: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CompressEvent {
    #[serde(rename_all = "camelCase")]
    Progress {
        job_id: String,
        percent: f64,
        #[serde(skip_serializing_if = "Option::is_none")]
        bytes_processed: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        bytes_total: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Log {
        job_id: String,
        message: String,
    },
    #[serde(rename_all = "camelCase")]
    Complete {
        job_id: String,
        output_path: String,
        original_bytes: u64,
        result_bytes: u64,
        duration_ms: u64,
    },
    #[serde(rename_all = "camelCase")]
    Failed {
        job_id: String,
        error: String,
    },
}

pub const COMPRESS_EVENT: &str = "compress-event";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compress_event_serde_matches_ts_tags() {
        let progress = CompressEvent::Progress {
            job_id: "job-1".into(),
            percent: 20.0,
            bytes_processed: Some(10),
            bytes_total: Some(50),
        };
        let json = serde_json::to_string(&progress).expect("ser");
        assert!(json.contains("\"type\":\"progress\""));
        assert!(json.contains("\"jobId\":\"job-1\""));
        assert!(json.contains("\"bytesProcessed\":10"));

        let complete = CompressEvent::Complete {
            job_id: "job-1".into(),
            output_path: "/tmp/x.stub".into(),
            original_bytes: 50,
            result_bytes: 8,
            duration_ms: 120,
        };
        let json = serde_json::to_string(&complete).expect("ser");
        assert!(json.contains("\"type\":\"complete\""));
        assert!(json.contains("\"outputPath\":\"/tmp/x.stub\""));
        assert!(json.contains("\"originalBytes\":50"));

        let failed = CompressEvent::Failed {
            job_id: "job-1".into(),
            error: "cancelled".into(),
        };
        let json = serde_json::to_string(&failed).expect("ser");
        assert!(json.contains("\"type\":\"failed\""));
        assert!(json.contains("\"error\":\"cancelled\""));
    }

    #[test]
    fn start_request_deserializes_camel_case() {
        let raw = r#"{"sourcePath":"/a.png","mediaKind":"image","presetId":"stub"}"#;
        let req: CompressStartRequest = serde_json::from_str(raw).expect("de");
        assert_eq!(req.source_path, "/a.png");
        assert_eq!(req.media_kind, MediaKind::Image);
        assert_eq!(req.preset_id, "stub");

        let pdf_raw =
            r#"{"sourcePath":"/docs/report.pdf","mediaKind":"pdf","presetId":"pdf-ebook"}"#;
        let pdf_req: CompressStartRequest = serde_json::from_str(pdf_raw).expect("de pdf");
        assert_eq!(pdf_req.source_path, "/docs/report.pdf");
        assert_eq!(pdf_req.media_kind, MediaKind::Pdf);
        assert_eq!(pdf_req.preset_id, "pdf-ebook");
    }
}
