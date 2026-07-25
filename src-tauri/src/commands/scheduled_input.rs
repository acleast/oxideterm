// Copyright (C) 2026 AnalyseDeCircuit
// SPDX-License-Identifier: GPL-3.0-only

//! In-memory scheduled terminal input.

use chrono::{
    DateTime, Days, Local, LocalResult, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc,
};
use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Weak};
use std::time::Duration;
use tauri::State;
use tracing::{debug, warn};
use uuid::Uuid;

#[cfg(feature = "local-terminal")]
use crate::commands::local::LocalTerminalState;
use crate::session::SessionRegistry;
use crate::ssh::SessionCommand;

const SCHEDULER_TICK: Duration = Duration::from_secs(1);
const INPUT_SEND_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_COMMAND_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScheduledInputTargetKind {
    Ssh,
    Local,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScheduledInputRepeat {
    Once,
    Daily,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScheduledInputStatus {
    Waiting,
    Pending,
    Success,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledInputTask {
    pub id: String,
    pub session_id: String,
    pub target_kind: ScheduledInputTargetKind,
    pub command: String,
    pub repeat: ScheduledInputRepeat,
    pub once_run_at: Option<DateTime<Utc>>,
    pub daily_times: Vec<String>,
    pub next_run_at: DateTime<Utc>,
    pub pending: bool,
    pub last_run_at: Option<DateTime<Utc>>,
    pub status: ScheduledInputStatus,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateScheduledInputRequest {
    pub session_id: String,
    pub target_kind: ScheduledInputTargetKind,
    pub command: String,
    pub repeat: ScheduledInputRepeat,
    pub once_run_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub daily_times: Vec<String>,
}

#[derive(Debug)]
struct ScheduledInputEntry {
    task: ScheduledInputTask,
    parsed_daily_times: Vec<NaiveTime>,
}

struct ScheduledInputInner {
    tasks: RwLock<HashMap<String, ScheduledInputEntry>>,
    ssh_registry: Arc<SessionRegistry>,
    #[cfg(feature = "local-terminal")]
    local_state: Arc<LocalTerminalState>,
    shutdown: AtomicBool,
}

pub struct ScheduledInputManager {
    inner: Arc<ScheduledInputInner>,
    worker: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

impl ScheduledInputManager {
    #[cfg(feature = "local-terminal")]
    pub fn new(ssh_registry: Arc<SessionRegistry>, local_state: Arc<LocalTerminalState>) -> Self {
        Self {
            inner: Arc::new(ScheduledInputInner {
                tasks: RwLock::new(HashMap::new()),
                ssh_registry,
                local_state,
                shutdown: AtomicBool::new(false),
            }),
            worker: Mutex::new(None),
        }
    }

    #[cfg(not(feature = "local-terminal"))]
    pub fn new(ssh_registry: Arc<SessionRegistry>) -> Self {
        Self {
            inner: Arc::new(ScheduledInputInner {
                tasks: RwLock::new(HashMap::new()),
                ssh_registry,
                shutdown: AtomicBool::new(false),
            }),
            worker: Mutex::new(None),
        }
    }

    pub fn start(&self) {
        let mut worker = self.worker.lock();
        if worker.is_some() {
            return;
        }

        self.inner.shutdown.store(false, Ordering::Release);
        let inner = Arc::downgrade(&self.inner);
        *worker = Some(tauri::async_runtime::spawn(async move {
            run_scheduler(inner).await;
        }));
    }

    pub async fn shutdown(&self) {
        self.inner.shutdown.store(true, Ordering::Release);
        let worker = self.worker.lock().take();
        if let Some(worker) = worker {
            let _ = worker.await;
        }
        self.inner.tasks.write().clear();
    }

    pub fn create(
        &self,
        request: CreateScheduledInputRequest,
    ) -> Result<ScheduledInputTask, String> {
        let session_id = request.session_id.trim();
        if session_id.is_empty() {
            return Err("Session ID is required".to_string());
        }

        let command = request.command.trim_end_matches(['\r', '\n']).to_string();
        if command.trim().is_empty() {
            return Err("Command is required".to_string());
        }
        if command.len() > MAX_COMMAND_BYTES {
            return Err(format!(
                "Command exceeds the maximum size of {} bytes",
                MAX_COMMAND_BYTES
            ));
        }

        if !self.target_exists(request.target_kind, session_id) {
            return Err("Target terminal is no longer available".to_string());
        }

        let now = Utc::now();
        let (once_run_at, daily_times, parsed_daily_times, next_run_at) = match request.repeat {
            ScheduledInputRepeat::Once => {
                let run_at = request
                    .once_run_at
                    .ok_or_else(|| "One-time execution date is required".to_string())?;
                (Some(run_at), Vec::new(), Vec::new(), run_at)
            }
            ScheduledInputRepeat::Daily => {
                let parsed = parse_daily_times(&request.daily_times)?;
                let labels = parsed
                    .iter()
                    .map(|time| time.format("%H:%M").to_string())
                    .collect::<Vec<_>>();
                let next = next_daily_occurrence(&parsed, now)
                    .ok_or_else(|| "Could not calculate the next execution time".to_string())?;
                (None, labels, parsed, next)
            }
        };

        let task = ScheduledInputTask {
            id: Uuid::new_v4().to_string(),
            session_id: session_id.to_string(),
            target_kind: request.target_kind,
            command,
            repeat: request.repeat,
            once_run_at,
            daily_times,
            next_run_at,
            pending: false,
            last_run_at: None,
            status: ScheduledInputStatus::Waiting,
        };

        self.inner.tasks.write().insert(
            task.id.clone(),
            ScheduledInputEntry {
                task: task.clone(),
                parsed_daily_times,
            },
        );
        Ok(task)
    }

    pub fn list_for_session(&self, session_id: &str) -> Vec<ScheduledInputTask> {
        let mut tasks = self
            .inner
            .tasks
            .read()
            .values()
            .filter(|entry| entry.task.session_id == session_id)
            .map(|entry| entry.task.clone())
            .collect::<Vec<_>>();
        tasks.sort_by_key(|task| task.next_run_at);
        tasks
    }

    pub fn remove(&self, task_id: &str) -> bool {
        self.inner.tasks.write().remove(task_id).is_some()
    }

    pub fn remove_for_session(&self, session_id: &str) -> usize {
        let mut tasks = self.inner.tasks.write();
        let before = tasks.len();
        tasks.retain(|_, entry| entry.task.session_id != session_id);
        before - tasks.len()
    }

    fn target_exists(&self, kind: ScheduledInputTargetKind, session_id: &str) -> bool {
        target_exists(&self.inner, kind, session_id)
    }
}

#[derive(Clone)]
struct DueTask {
    id: String,
    session_id: String,
    target_kind: ScheduledInputTargetKind,
    input: Vec<u8>,
}

async fn run_scheduler(inner: Weak<ScheduledInputInner>) {
    let mut interval = tokio::time::interval(SCHEDULER_TICK);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        interval.tick().await;
        let Some(inner) = inner.upgrade() else {
            break;
        };
        if inner.shutdown.load(Ordering::Acquire) {
            break;
        }
        process_tick(&inner, Utc::now()).await;
    }
}

async fn process_tick(inner: &Arc<ScheduledInputInner>, now: DateTime<Utc>) {
    let (closed_task_ids, due_tasks) = {
        let tasks = inner.tasks.read();
        let mut closed = Vec::new();
        let mut due = Vec::new();

        for (id, entry) in tasks.iter() {
            if !target_exists(inner, entry.task.target_kind, &entry.task.session_id) {
                closed.push(id.clone());
                continue;
            }
            if entry.task.pending || entry.task.next_run_at <= now {
                due.push(DueTask {
                    id: id.clone(),
                    session_id: entry.task.session_id.clone(),
                    target_kind: entry.task.target_kind,
                    input: terminal_input_payload(&entry.task.command),
                });
            }
        }
        (closed, due)
    };

    if !closed_task_ids.is_empty() {
        let mut tasks = inner.tasks.write();
        for id in closed_task_ids {
            tasks.remove(&id);
        }
    }

    for due in due_tasks {
        let sent = send_input(inner, &due).await;
        let completed_at = Utc::now();
        let mut tasks = inner.tasks.write();
        let Some(entry) = tasks.get_mut(&due.id) else {
            continue;
        };

        if sent {
            entry.task.pending = false;
            entry.task.last_run_at = Some(completed_at);
            entry.task.status = ScheduledInputStatus::Success;
            match entry.task.repeat {
                ScheduledInputRepeat::Once => {
                    tasks.remove(&due.id);
                }
                ScheduledInputRepeat::Daily => {
                    if let Some(next) =
                        next_daily_occurrence(&entry.parsed_daily_times, completed_at)
                    {
                        entry.task.next_run_at = next;
                    } else {
                        warn!(
                            "Failed to calculate next scheduled input occurrence: task={}",
                            due.id
                        );
                        entry.task.pending = true;
                        entry.task.status = ScheduledInputStatus::Pending;
                    }
                }
            }
        } else {
            entry.task.pending = true;
            entry.task.status = ScheduledInputStatus::Pending;
        }
    }
}

fn target_exists(
    inner: &ScheduledInputInner,
    kind: ScheduledInputTargetKind,
    session_id: &str,
) -> bool {
    match kind {
        ScheduledInputTargetKind::Ssh => inner.ssh_registry.get(session_id).is_some(),
        ScheduledInputTargetKind::Local => {
            #[cfg(feature = "local-terminal")]
            {
                inner.local_state.registry.contains_session(session_id)
            }
            #[cfg(not(feature = "local-terminal"))]
            {
                let _ = session_id;
                false
            }
        }
    }
}

async fn send_input(inner: &ScheduledInputInner, due: &DueTask) -> bool {
    match due.target_kind {
        ScheduledInputTargetKind::Ssh => {
            let Some(tx) = inner.ssh_registry.get_cmd_tx(&due.session_id) else {
                return false;
            };
            matches!(
                tokio::time::timeout(
                    INPUT_SEND_TIMEOUT,
                    tx.send(SessionCommand::Data(due.input.clone())),
                )
                .await,
                Ok(Ok(()))
            )
        }
        ScheduledInputTargetKind::Local => {
            #[cfg(feature = "local-terminal")]
            {
                inner
                    .local_state
                    .registry
                    .write_to_session(&due.session_id, &due.input)
                    .await
                    .is_ok()
            }
            #[cfg(not(feature = "local-terminal"))]
            {
                false
            }
        }
    }
}

fn terminal_input_payload(command: &str) -> Vec<u8> {
    let mut input = command.as_bytes().to_vec();
    input.push(b'\r');
    input
}

fn parse_daily_times(values: &[String]) -> Result<Vec<NaiveTime>, String> {
    if values.is_empty() {
        return Err("At least one daily time is required".to_string());
    }

    let mut times = values
        .iter()
        .map(|value| {
            NaiveTime::parse_from_str(value.trim(), "%H:%M")
                .map_err(|_| format!("Invalid daily time: {}", value))
        })
        .collect::<Result<Vec<_>, _>>()?;
    times.sort_unstable();
    times.dedup();
    Ok(times)
}

fn next_daily_occurrence(times: &[NaiveTime], after: DateTime<Utc>) -> Option<DateTime<Utc>> {
    let local_after = after.with_timezone(&Local);
    let start_date = local_after.date_naive();

    for day_offset in 0..=8 {
        let date = start_date.checked_add_days(Days::new(day_offset))?;
        for time in times {
            let Some(candidate) = resolve_local_datetime(date, *time) else {
                continue;
            };
            let candidate_utc = candidate.with_timezone(&Utc);
            if candidate_utc > after {
                return Some(candidate_utc);
            }
        }
    }
    None
}

fn resolve_local_datetime(date: NaiveDate, time: NaiveTime) -> Option<DateTime<Local>> {
    let local = NaiveDateTime::new(date, time);
    match Local.from_local_datetime(&local) {
        LocalResult::Single(value) => Some(value),
        LocalResult::Ambiguous(first, second) => Some(first.min(second)),
        LocalResult::None => {
            debug!("Skipping nonexistent local scheduled time: {}", local);
            None
        }
    }
}

#[tauri::command]
pub fn create_scheduled_input(
    request: CreateScheduledInputRequest,
    manager: State<'_, Arc<ScheduledInputManager>>,
) -> Result<ScheduledInputTask, String> {
    manager.create(request)
}

#[tauri::command]
pub fn list_scheduled_inputs(
    session_id: String,
    manager: State<'_, Arc<ScheduledInputManager>>,
) -> Vec<ScheduledInputTask> {
    manager.list_for_session(&session_id)
}

#[tauri::command]
pub fn delete_scheduled_input(
    task_id: String,
    manager: State<'_, Arc<ScheduledInputManager>>,
) -> bool {
    manager.remove(&task_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::SessionConfig;
    use chrono::{Datelike, Timelike};

    fn test_manager(registry: Arc<SessionRegistry>) -> ScheduledInputManager {
        #[cfg(feature = "local-terminal")]
        {
            ScheduledInputManager::new(registry, Arc::new(LocalTerminalState::new()))
        }
        #[cfg(not(feature = "local-terminal"))]
        {
            ScheduledInputManager::new(registry)
        }
    }

    #[test]
    fn parses_and_deduplicates_daily_times() {
        let parsed = parse_daily_times(&[
            "18:00".to_string(),
            "03:00".to_string(),
            "18:00".to_string(),
        ])
        .unwrap();

        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].hour(), 3);
        assert_eq!(parsed[1].hour(), 18);
    }

    #[test]
    fn scheduled_input_always_appends_enter() {
        assert_eq!(terminal_input_payload("echo ready"), b"echo ready\r");
        assert_eq!(
            terminal_input_payload("printf 'first\\nsecond'"),
            b"printf 'first\\nsecond'\r"
        );
    }

    #[test]
    fn next_daily_occurrence_uses_later_time_on_same_day() {
        let local_now = Local
            .with_ymd_and_hms(2026, 7, 25, 4, 30, 0)
            .single()
            .unwrap();
        let times = vec![
            NaiveTime::from_hms_opt(3, 0, 0).unwrap(),
            NaiveTime::from_hms_opt(6, 0, 0).unwrap(),
        ];

        let next = next_daily_occurrence(&times, local_now.with_timezone(&Utc))
            .unwrap()
            .with_timezone(&Local);

        assert_eq!(next.date_naive(), local_now.date_naive());
        assert_eq!(next.hour(), 6);
    }

    #[test]
    fn next_daily_occurrence_rolls_to_next_day() {
        let local_now = Local
            .with_ymd_and_hms(2026, 7, 25, 23, 0, 0)
            .single()
            .unwrap();
        let times = vec![NaiveTime::from_hms_opt(3, 0, 0).unwrap()];

        let next = next_daily_occurrence(&times, local_now.with_timezone(&Utc))
            .unwrap()
            .with_timezone(&Local);

        assert_eq!(next.day(), local_now.day() + 1);
        assert_eq!(next.hour(), 3);
    }

    #[tokio::test]
    async fn removes_tasks_after_the_target_terminal_closes() {
        let registry = Arc::new(SessionRegistry::new_without_persistence());
        let session_id = registry
            .create_session(SessionConfig::with_password(
                "example.test",
                22,
                "tester",
                "not-used",
            ))
            .unwrap();
        let manager = test_manager(registry.clone());

        manager
            .create(CreateScheduledInputRequest {
                session_id: session_id.clone(),
                target_kind: ScheduledInputTargetKind::Ssh,
                command: "echo ready".to_string(),
                repeat: ScheduledInputRepeat::Daily,
                once_run_at: None,
                daily_times: vec!["03:00".to_string(), "06:00".to_string()],
            })
            .unwrap();
        assert_eq!(manager.list_for_session(&session_id).len(), 1);

        registry.remove(&session_id);
        process_tick(&manager.inner, Utc::now()).await;

        assert!(manager.list_for_session(&session_id).is_empty());
    }
}
