use super::types::JobStatus;

/// Pure job lifecycle transitions. Terminal statuses reject further work.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransitionError {
    AlreadyTerminal,
    NotRunning,
    NotCancellable,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Transition {
    Start,
    Progress { percent: f64 },
    Complete,
    Fail,
    Cancel,
}

pub fn apply_transition(
    status: JobStatus,
    transition: Transition,
) -> Result<(JobStatus, Option<f64>), TransitionError> {
    match (&status, transition) {
        (JobStatus::Queued, Transition::Start) => Ok((JobStatus::Running, Some(0.0))),
        (JobStatus::Running, Transition::Progress { percent }) => {
            let clamped = percent.clamp(0.0, 100.0);
            Ok((JobStatus::Running, Some(clamped)))
        }
        (JobStatus::Running, Transition::Complete) => Ok((JobStatus::Completed, Some(100.0))),
        (JobStatus::Running, Transition::Fail) => Ok((JobStatus::Failed, None)),
        (JobStatus::Queued | JobStatus::Running, Transition::Cancel) => {
            Ok((JobStatus::Cancelled, None))
        }
        (
            JobStatus::Completed | JobStatus::Failed | JobStatus::Cancelled,
            Transition::Cancel,
        ) => Err(TransitionError::NotCancellable),
        (JobStatus::Completed | JobStatus::Failed | JobStatus::Cancelled, _) => {
            Err(TransitionError::AlreadyTerminal)
        }
        (_, Transition::Start) => Err(TransitionError::NotRunning),
        (_, Transition::Progress { .. } | Transition::Complete | Transition::Fail) => {
            Err(TransitionError::NotRunning)
        }
        (_, Transition::Cancel) => Err(TransitionError::NotCancellable),
    }
}

/// Whether the worker should keep producing progress / writing output.
pub fn should_continue(status: JobStatus, cancel_requested: bool) -> bool {
    matches!(status, JobStatus::Running) && !cancel_requested
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queued_starts_running_at_zero() {
        let (status, percent) =
            apply_transition(JobStatus::Queued, Transition::Start).expect("start");
        assert_eq!(status, JobStatus::Running);
        assert_eq!(percent, Some(0.0));
    }

    #[test]
    fn running_accepts_progress() {
        let (status, percent) = apply_transition(
            JobStatus::Running,
            Transition::Progress { percent: 42.5 },
        )
        .expect("progress");
        assert_eq!(status, JobStatus::Running);
        assert_eq!(percent, Some(42.5));
    }

    #[test]
    fn progress_clamps_to_unit_interval() {
        let (_, high) =
            apply_transition(JobStatus::Running, Transition::Progress { percent: 150.0 })
                .expect("high");
        let (_, low) =
            apply_transition(JobStatus::Running, Transition::Progress { percent: -3.0 })
                .expect("low");
        assert_eq!(high, Some(100.0));
        assert_eq!(low, Some(0.0));
    }

    #[test]
    fn running_completes() {
        let (status, percent) =
            apply_transition(JobStatus::Running, Transition::Complete).expect("complete");
        assert_eq!(status, JobStatus::Completed);
        assert_eq!(percent, Some(100.0));
    }

    #[test]
    fn running_fails() {
        let (status, percent) =
            apply_transition(JobStatus::Running, Transition::Fail).expect("fail");
        assert_eq!(status, JobStatus::Failed);
        assert_eq!(percent, None);
    }

    #[test]
    fn cancel_from_queued_or_running() {
        let (q, _) = apply_transition(JobStatus::Queued, Transition::Cancel).expect("queued");
        let (r, _) = apply_transition(JobStatus::Running, Transition::Cancel).expect("running");
        assert_eq!(q, JobStatus::Cancelled);
        assert_eq!(r, JobStatus::Cancelled);
    }

    #[test]
    fn cancel_rejected_when_terminal() {
        assert_eq!(
            apply_transition(JobStatus::Completed, Transition::Cancel),
            Err(TransitionError::NotCancellable)
        );
        assert_eq!(
            apply_transition(JobStatus::Failed, Transition::Cancel),
            Err(TransitionError::NotCancellable)
        );
        assert_eq!(
            apply_transition(JobStatus::Cancelled, Transition::Cancel),
            Err(TransitionError::NotCancellable)
        );
    }

    #[test]
    fn terminal_rejects_further_work() {
        assert_eq!(
            apply_transition(JobStatus::Completed, Transition::Progress { percent: 1.0 }),
            Err(TransitionError::AlreadyTerminal)
        );
        assert_eq!(
            apply_transition(JobStatus::Failed, Transition::Complete),
            Err(TransitionError::AlreadyTerminal)
        );
    }

    #[test]
    fn cooperative_continue_respects_cancel_flag() {
        assert!(should_continue(JobStatus::Running, false));
        assert!(!should_continue(JobStatus::Running, true));
        assert!(!should_continue(JobStatus::Cancelled, false));
        assert!(!should_continue(JobStatus::Completed, false));
    }
}
