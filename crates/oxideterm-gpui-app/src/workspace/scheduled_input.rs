// Copyright (C) 2026 AnalyseDeCircuit
// SPDX-License-Identifier: GPL-3.0-only

use chrono::{
    DateTime, Days, Local, LocalResult, NaiveDateTime, NaiveTime, TimeZone, Timelike, Utc,
};
use oxideterm_gpui_terminal::TerminalNoticeVariant;
use uuid::Uuid;
use zeroize::Zeroizing;

use super::*;

const SCHEDULER_TICK: Duration = Duration::from_secs(1);
const MAX_COMMAND_BYTES: usize = 64 * 1024;
const MIN_ONCE_DELAY_MINUTES: i64 = 1;
const MAX_ONCE_DELAY_MINUTES: i64 = 30 * 24 * 60;
const MINUTES_PER_DAY: i32 = 24 * 60;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ScheduledInputRepeat {
    Once,
    OnceAt,
    Daily,
}

#[derive(Clone)]
struct ScheduledInputTask {
    id: Uuid,
    session_id: TerminalSessionId,
    command: Zeroizing<String>,
    repeat: ScheduledInputRepeat,
    daily_minute: Option<u16>,
    next_run_at: DateTime<Utc>,
    pending: bool,
    last_run_at: Option<DateTime<Utc>>,
}

pub(super) struct ScheduledInputState {
    pub(super) open: bool,
    target_session_id: Option<TerminalSessionId>,
    repeat: ScheduledInputRepeat,
    once_delay_minutes: i64,
    daily_minute: u16,
    pub(super) command_draft: Zeroizing<String>,
    pub(super) command_focused: bool,
    pub(super) time_focused: bool,
    pub(super) time_draft: String,
    tasks: Vec<ScheduledInputTask>,
    polling: bool,
}

impl ScheduledInputState {
    pub(super) fn new() -> Self {
        let next_hour = Local::now() + chrono::Duration::hours(1);
        Self {
            open: false,
            target_session_id: None,
            repeat: ScheduledInputRepeat::Daily,
            once_delay_minutes: 5,
            daily_minute: (next_hour.hour() * 60) as u16,
            command_draft: Zeroizing::new(String::new()),
            command_focused: false,
            time_focused: false,
            time_draft: String::new(),
            tasks: Vec::new(),
            polling: false,
        }
    }
}

impl WorkspaceApp {
    pub(super) fn rebind_scheduled_input_session(
        &mut self,
        old_session_id: TerminalSessionId,
        new_session_id: TerminalSessionId,
    ) {
        for task in &mut self.scheduled_input.tasks {
            if task.session_id == old_session_id {
                task.session_id = new_session_id;
            }
        }
    }

    pub(super) fn scheduled_input_popover_open(&self) -> bool {
        self.scheduled_input.open
    }

    pub(super) fn active_terminal_scheduled_input_count(&self) -> usize {
        let Some(session_id) = self.active_terminal_session_id() else {
            return 0;
        };
        self.scheduled_input
            .tasks
            .iter()
            .filter(|task| task.session_id == session_id)
            .count()
    }

    pub(super) fn toggle_scheduled_input_popover(&mut self, cx: &mut Context<Self>) {
        if self.scheduled_input.open {
            self.scheduled_input.open = false;
            self.scheduled_input.target_session_id = None;
            self.scheduled_input.command_focused = false;
            self.scheduled_input.time_focused = false;
            self.scheduled_input.time_draft.clear();
            self.scheduled_input.command_draft = Zeroizing::new(String::new());
            cx.notify();
            return;
        }
        if self.active_tab_has_serial_terminal() {
            return;
        }
        let Some(session_id) = self.active_terminal_session_id() else {
            return;
        };
        self.scheduled_input.target_session_id = Some(session_id);
        self.scheduled_input.open = true;
        self.scheduled_input.command_draft =
            Zeroizing::new(self.terminal_command_bar_draft.clone());
        self.scheduled_input.command_focused = true;
        self.scheduled_input.time_focused = false;
        self.scheduled_input.time_draft.clear();
        self.terminal_command_bar_focused = false;
        self.terminal_command_suggestions_open = false;
        self.close_terminal_quick_commands_popover();
        cx.notify();
    }

    fn set_scheduled_input_repeat(&mut self, repeat: ScheduledInputRepeat, cx: &mut Context<Self>) {
        self.scheduled_input.repeat = repeat;
        cx.notify();
    }

    fn adjust_scheduled_input_once_delay(&mut self, delta: i64, cx: &mut Context<Self>) {
        self.scheduled_input.once_delay_minutes = (self.scheduled_input.once_delay_minutes + delta)
            .clamp(MIN_ONCE_DELAY_MINUTES, MAX_ONCE_DELAY_MINUTES);
        cx.notify();
    }

    fn adjust_scheduled_input_daily_time(&mut self, delta_minutes: i32, cx: &mut Context<Self>) {
        self.scheduled_input.daily_minute = (i32::from(self.scheduled_input.daily_minute)
            + delta_minutes)
            .rem_euclid(MINUTES_PER_DAY) as u16;
        cx.notify();
    }

    pub(super) fn set_scheduled_input_time_focused(&mut self, cx: &mut Context<Self>) {
        self.scheduled_input.time_focused = true;
        self.scheduled_input.command_focused = false;
        self.scheduled_input.time_draft = format_daily_minute(self.scheduled_input.daily_minute);
        self.ime_marked_text = None;
        cx.notify();
    }

    pub(super) fn commit_scheduled_input_time_draft(&mut self, cx: &mut Context<Self>) {
        if let Some(minute) = parse_daily_minute(&self.scheduled_input.time_draft) {
            self.scheduled_input.daily_minute = minute;
        }
        self.scheduled_input.time_focused = false;
        self.scheduled_input.time_draft.clear();
        cx.notify();
    }

    pub(super) fn add_scheduled_input_task(&mut self, cx: &mut Context<Self>) {
        let Some(session_id) = self.scheduled_input.target_session_id else {
            return;
        };
        if !self.terminal_locations.contains_key(&session_id) {
            self.push_command_palette_toast(
                self.i18n.t("terminal.scheduled_input.save_failed"),
                None,
                TerminalNoticeVariant::Error,
            );
            return;
        }
        // Scheduled command text may contain credentials. Keep the retained
        // task and editable draft zeroizing, and never include either in logs.
        let command = Zeroizing::new(
            self.scheduled_input
                .command_draft
                .trim_end_matches(['\r', '\n'])
                .to_string(),
        );
        if command.trim().is_empty() {
            self.push_command_palette_toast(
                self.i18n.t("terminal.scheduled_input.command_required"),
                None,
                TerminalNoticeVariant::Error,
            );
            return;
        }
        if command.len() > MAX_COMMAND_BYTES {
            self.push_command_palette_toast(
                self.i18n.t("terminal.scheduled_input.save_failed"),
                None,
                TerminalNoticeVariant::Error,
            );
            return;
        }

        let now = Utc::now();
        let (daily_minute, next_run_at) = match self.scheduled_input.repeat {
            ScheduledInputRepeat::Once => (
                None,
                now + chrono::Duration::minutes(self.scheduled_input.once_delay_minutes),
            ),
            ScheduledInputRepeat::OnceAt => {
                let minute = self.scheduled_input.daily_minute;
                let Some(next) = next_daily_occurrence(minute, now) else {
                    self.push_command_palette_toast(
                        self.i18n.t("terminal.scheduled_input.save_failed"),
                        None,
                        TerminalNoticeVariant::Error,
                    );
                    return;
                };
                (Some(minute), next)
            }
            ScheduledInputRepeat::Daily => {
                let minute = self.scheduled_input.daily_minute;
                let Some(next) = next_daily_occurrence(minute, now) else {
                    self.push_command_palette_toast(
                        self.i18n.t("terminal.scheduled_input.save_failed"),
                        None,
                        TerminalNoticeVariant::Error,
                    );
                    return;
                };
                (Some(minute), next)
            }
        };
        self.scheduled_input.tasks.push(ScheduledInputTask {
            id: Uuid::new_v4(),
            session_id,
            command,
            repeat: self.scheduled_input.repeat,
            daily_minute,
            next_run_at,
            pending: false,
            last_run_at: None,
        });
        self.start_scheduled_input_polling(cx);
        self.push_command_palette_toast(
            self.i18n.t("terminal.scheduled_input.saved"),
            None,
            TerminalNoticeVariant::Success,
        );
        self.scheduled_input.command_draft = Zeroizing::new(String::new());
        cx.notify();
    }

    fn remove_scheduled_input_task(&mut self, task_id: Uuid, cx: &mut Context<Self>) {
        self.scheduled_input.tasks.retain(|task| task.id != task_id);
        if self.scheduled_input.tasks.is_empty() {
            self.scheduled_input.polling = false;
        }
        cx.notify();
    }

    fn start_scheduled_input_polling(&mut self, cx: &mut Context<Self>) {
        if self.scheduled_input.polling {
            return;
        }
        self.scheduled_input.polling = true;
        cx.spawn(async move |weak, cx| {
            loop {
                Timer::after(SCHEDULER_TICK).await;
                let keep_polling = weak
                    .update(cx, |this, cx| {
                        this.process_scheduled_input_tick(Utc::now(), cx);
                        this.scheduled_input.polling
                    })
                    .unwrap_or(false);
                if !keep_polling {
                    break;
                }
            }
        })
        .detach();
    }

    fn process_scheduled_input_tick(&mut self, now: DateTime<Utc>, cx: &mut Context<Self>) {
        let before = self.scheduled_input.tasks.len();
        self.scheduled_input
            .tasks
            .retain(|task| self.terminal_locations.contains_key(&task.session_id));
        let due = self
            .scheduled_input
            .tasks
            .iter()
            .filter(|task| task.pending || task.next_run_at <= now)
            .map(|task| (task.id, task.session_id, task.command.clone()))
            .collect::<Vec<_>>();
        let had_due = !due.is_empty();

        for (task_id, session_id, command) in due {
            let sent = self
                .terminal_locations
                .get(&session_id)
                .and_then(|location| self.panes.get(&location.pane_id))
                .cloned()
                .is_some_and(|pane| {
                    if !pane.read(cx).ai_accepts_input() {
                        return false;
                    }
                    pane.update(cx, |pane, cx| pane.send_command_line(&command, cx))
                });
            let Some(index) = self
                .scheduled_input
                .tasks
                .iter()
                .position(|task| task.id == task_id)
            else {
                continue;
            };
            if !sent {
                self.scheduled_input.tasks[index].pending = true;
                continue;
            }
            let completed_at = Utc::now();
            match self.scheduled_input.tasks[index].repeat {
                ScheduledInputRepeat::Once | ScheduledInputRepeat::OnceAt => {
                    self.scheduled_input.tasks.remove(index);
                }
                ScheduledInputRepeat::Daily => {
                    let minute = self.scheduled_input.tasks[index]
                        .daily_minute
                        .expect("daily scheduled input has a local time");
                    let task = &mut self.scheduled_input.tasks[index];
                    task.pending = false;
                    task.last_run_at = Some(completed_at);
                    if let Some(next) = next_daily_occurrence(minute, completed_at) {
                        task.next_run_at = next;
                    } else {
                        task.pending = true;
                    }
                }
            }
        }
        self.scheduled_input.polling = !self.scheduled_input.tasks.is_empty();
        if before != self.scheduled_input.tasks.len() || had_due {
            cx.notify();
        }
    }

    pub(super) fn render_scheduled_input_popover(&self, cx: &mut Context<Self>) -> AnyElement {
        let theme = self.tokens.ui;
        let target_session_id = self.scheduled_input.target_session_id;
        let tasks = target_session_id
            .map(|session_id| {
                self.scheduled_input
                    .tasks
                    .iter()
                    .filter(|task| task.session_id == session_id)
                    .cloned()
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let tasks_empty = tasks.is_empty();
        let command_placeholder = self
            .i18n
            .t("terminal.scheduled_input.command_input_placeholder");
        let once_label = format!(
            "{} {} min",
            self.i18n.t("terminal.scheduled_input.run_in"),
            self.scheduled_input.once_delay_minutes
        );
        let mut task_list = div().flex().flex_col().gap(px(6.0));
        for task in tasks {
            let task_id = task.id;
            let schedule = match task.repeat {
                ScheduledInputRepeat::Once => self.i18n.t("terminal.scheduled_input.once"),
                ScheduledInputRepeat::OnceAt => format!(
                    "{} {}",
                    self.i18n.t("terminal.scheduled_input.at_time"),
                    format_daily_minute(task.daily_minute.unwrap_or_default())
                ),
                ScheduledInputRepeat::Daily => format!(
                    "{} {}",
                    self.i18n.t("terminal.scheduled_input.daily"),
                    format_daily_minute(task.daily_minute.unwrap_or_default())
                ),
            };
            let next = task
                .next_run_at
                .with_timezone(&Local)
                .format("%Y-%m-%d %H:%M")
                .to_string();
            task_list = task_list.child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.0))
                    .rounded(px(self.tokens.radii.md))
                    .border_1()
                    .border_color(rgb(theme.border))
                    .px(px(8.0))
                    .py(px(6.0))
                    .child(
                        div()
                            .flex_1()
                            .min_w(px(0.0))
                            .flex()
                            .flex_col()
                            .gap(px(2.0))
                            .child(
                                div()
                                    .truncate()
                                    .text_size(px(12.0))
                                    .child(task.command.as_str().to_string()),
                            )
                            .child(
                                div()
                                    .text_size(px(10.0))
                                    .text_color(if task.pending {
                                        rgb(theme.warning)
                                    } else {
                                        rgb(theme.text_muted)
                                    })
                                    .child(format!("{schedule} · {next}")),
                            ),
                    )
                    .child(
                        div()
                            .id(("scheduled-input-delete", task_id.as_u128() as u64))
                            .size(px(24.0))
                            .flex()
                            .items_center()
                            .justify_center()
                            .rounded(px(self.tokens.radii.md))
                            .cursor_pointer()
                            .hover(move |button| button.bg(rgb(theme.bg_hover)))
                            .child(Self::render_lucide_icon(
                                LucideIcon::Trash2,
                                13.0,
                                rgb(theme.error),
                            ))
                            .on_mouse_down(
                                MouseButton::Left,
                                cx.listener(move |this, _event, _window, cx| {
                                    this.remove_scheduled_input_task(task_id, cx);
                                    cx.stop_propagation();
                                }),
                            ),
                    ),
            );
        }

        let repeat = self.scheduled_input.repeat;
        div()
            .absolute()
            .bottom(px(34.0))
            .right(px(12.0))
            .w(px(440.0))
            .max_h(px(560.0))
            .overflow_y_scrollbar()
            .rounded(px(self.tokens.radii.lg))
            .border_1()
            .border_color(rgb(theme.border))
            .bg(rgb(theme.bg_panel))
            .shadow_lg()
            .p(px(12.0))
            .flex()
            .flex_col()
            .gap(px(10.0))
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(
                        div()
                            .text_size(px(14.0))
                            .font_weight(gpui::FontWeight::SEMIBOLD)
                            .child(self.i18n.t("terminal.scheduled_input.title")),
                    )
                    .child(
                        div()
                            .id("scheduled-input-close")
                            .size(px(24.0))
                            .flex()
                            .items_center()
                            .justify_center()
                            .rounded(px(self.tokens.radii.md))
                            .cursor_pointer()
                            .hover(move |button| button.bg(rgb(theme.bg_hover)))
                            .child(Self::render_lucide_icon(
                                LucideIcon::X,
                                14.0,
                                rgb(theme.text_muted),
                            ))
                            .on_mouse_down(
                                MouseButton::Left,
                                cx.listener(|this, _event, _window, cx| {
                                    this.toggle_scheduled_input_popover(cx);
                                    cx.stop_propagation();
                                }),
                            ),
                    ),
            )
            .child(
                div()
                    .text_size(px(11.0))
                    .text_color(rgb(theme.text_muted))
                    .child(self.i18n.t("terminal.scheduled_input.description")),
            )
            .child(
                div()
                    .id("scheduled-input-command")
                    .rounded(px(self.tokens.radii.md))
                    .bg(rgb(theme.bg))
                    .px(px(8.0))
                    .py(px(6.0))
                    .min_h(px(32.0))
                    .cursor_text()
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(move |this, event: &gpui::MouseDownEvent, window, cx| {
                            this.scheduled_input.command_focused = true;
                            this.ime_marked_text = None;
                            window.focus(&this.focus_handle, cx);
                            this.begin_ime_selection_from_mouse_down(
                                WorkspaceImeTarget::ScheduledInput,
                                event,
                                window,
                                cx,
                            );
                            cx.notify();
                        }),
                    )
                    .on_mouse_move(
                        cx.listener(|this, event: &gpui::MouseMoveEvent, window, cx| {
                            this.update_ime_selection_drag_from_mouse_move(event, window, cx);
                        }),
                    )
                    .child(text_input_anchor_probe(
                        WorkspaceImeTarget::ScheduledInput.anchor_id(),
                        text_input(
                            &self.tokens,
                            TextInputView {
                                value: self.scheduled_input.command_draft.as_str(),
                                placeholder: command_placeholder,
                                focused: self.scheduled_input.command_focused,
                                caret_visible: self.new_connection_caret_visible,
                                secret: false,
                                selected_all: false,
                                selected_range: self.ime_selected_range_for_target(
                                    WorkspaceImeTarget::ScheduledInput,
                                ),
                                marked_text: self
                                    .marked_text_for_target(WorkspaceImeTarget::ScheduledInput),
                            },
                        ),
                        {
                            let workspace = cx.entity();
                            move |anchor, _window, cx| {
                                let _ = workspace.update(cx, |this, cx| {
                                    this.update_text_input_anchor(anchor, cx);
                                });
                            }
                        },
                    )),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.0))
                    .child(self.scheduled_input_choice_button(
                        self.i18n.t("terminal.scheduled_input.once"),
                        repeat == ScheduledInputRepeat::Once,
                        move |this, cx| {
                            this.set_scheduled_input_repeat(ScheduledInputRepeat::Once, cx)
                        },
                        cx,
                    ))
                    .child(self.scheduled_input_choice_button(
                        self.i18n.t("terminal.scheduled_input.at_time"),
                        repeat == ScheduledInputRepeat::OnceAt,
                        move |this, cx| {
                            this.set_scheduled_input_repeat(ScheduledInputRepeat::OnceAt, cx)
                        },
                        cx,
                    ))
                    .child(self.scheduled_input_choice_button(
                        self.i18n.t("terminal.scheduled_input.daily"),
                        repeat == ScheduledInputRepeat::Daily,
                        move |this, cx| {
                            this.set_scheduled_input_repeat(ScheduledInputRepeat::Daily, cx)
                        },
                        cx,
                    )),
            )
            .child(match repeat {
                ScheduledInputRepeat::Once => self.render_scheduled_input_stepper(
                    once_label,
                    |this, cx| this.adjust_scheduled_input_once_delay(-5, cx),
                    |this, cx| this.adjust_scheduled_input_once_delay(5, cx),
                    cx,
                ),
                ScheduledInputRepeat::OnceAt => self.render_scheduled_input_time_control(
                    |this, cx| this.adjust_scheduled_input_daily_time(-1, cx),
                    |this, cx| this.adjust_scheduled_input_daily_time(1, cx),
                    cx,
                ),
                ScheduledInputRepeat::Daily => self.render_scheduled_input_time_control(
                    |this, cx| this.adjust_scheduled_input_daily_time(-15, cx),
                    |this, cx| this.adjust_scheduled_input_daily_time(15, cx),
                    cx,
                ),
            })
            .child(
                div()
                    .id("scheduled-input-save")
                    .h(px(30.0))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(px(self.tokens.radii.md))
                    .cursor_pointer()
                    .bg(rgb(theme.accent))
                    .text_size(px(12.0))
                    .text_color(rgb(0xffffff))
                    .child(self.i18n.t("terminal.scheduled_input.save"))
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(|this, _event, _window, cx| {
                            this.add_scheduled_input_task(cx);
                            cx.stop_propagation();
                        }),
                    ),
            )
            .child(
                div()
                    .pt(px(4.0))
                    .border_t_1()
                    .border_color(rgb(theme.border))
                    .text_size(px(11.0))
                    .text_color(rgb(theme.text_muted))
                    .child(self.i18n.t("terminal.scheduled_input.tasks")),
            )
            .child(if tasks_empty {
                div()
                    .py(px(8.0))
                    .text_size(px(11.0))
                    .text_color(rgb(theme.text_muted))
                    .child(self.i18n.t("terminal.scheduled_input.empty"))
                    .into_any_element()
            } else {
                task_list.into_any_element()
            })
            .into_any_element()
    }

    fn scheduled_input_choice_button(
        &self,
        label: String,
        selected: bool,
        action: impl Fn(&mut Self, &mut Context<Self>) + 'static,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let theme = self.tokens.ui;
        div()
            .h(px(28.0))
            .px(px(10.0))
            .flex()
            .items_center()
            .rounded(px(self.tokens.radii.md))
            .cursor_pointer()
            .bg(if selected {
                rgba((theme.accent << 8) | 0x26)
            } else {
                rgba(0x00000000)
            })
            .text_size(px(11.0))
            .text_color(rgb(if selected {
                theme.accent
            } else {
                theme.text_muted
            }))
            .child(label)
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |this, _event, _window, cx| {
                    action(this, cx);
                    cx.stop_propagation();
                }),
            )
            .into_any_element()
    }

    fn render_scheduled_input_stepper(
        &self,
        label: String,
        decrement: impl Fn(&mut Self, &mut Context<Self>) + 'static,
        increment: impl Fn(&mut Self, &mut Context<Self>) + 'static,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let theme = self.tokens.ui;
        div()
            .flex()
            .items_center()
            .justify_between()
            .child(
                div()
                    .id("scheduled-input-decrement")
                    .size(px(28.0))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(px(self.tokens.radii.md))
                    .border_1()
                    .border_color(rgb(theme.border))
                    .cursor_pointer()
                    .child("−")
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(move |this, _event, _window, cx| {
                            decrement(this, cx);
                            cx.stop_propagation();
                        }),
                    ),
            )
            .child(div().text_size(px(12.0)).child(label))
            .child(
                div()
                    .id("scheduled-input-increment")
                    .size(px(28.0))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(px(self.tokens.radii.md))
                    .border_1()
                    .border_color(rgb(theme.border))
                    .cursor_pointer()
                    .child("+")
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(move |this, _event, _window, cx| {
                            increment(this, cx);
                            cx.stop_propagation();
                        }),
                    ),
            )
            .into_any_element()
    }
    fn render_scheduled_input_time_control(
        &self,
        decrement: impl Fn(&mut Self, &mut Context<Self>) + 'static,
        increment: impl Fn(&mut Self, &mut Context<Self>) + 'static,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let theme = self.tokens.ui;
        let time_focused = self.scheduled_input.time_focused;
        let daily_label = format_daily_minute(self.scheduled_input.daily_minute);
        let time_draft = self.scheduled_input.time_draft.clone();

        let center = if time_focused {
            div().flex_1().min_w(px(0.0)).child(text_input_anchor_probe(
                WorkspaceImeTarget::ScheduledInputTime.anchor_id(),
                text_input(
                    &self.tokens,
                    TextInputView {
                        value: &time_draft,
                        placeholder: "HH:MM".to_string(),
                        focused: true,
                        caret_visible: self.new_connection_caret_visible,
                        secret: false,
                        selected_all: false,
                        selected_range: self
                            .ime_selected_range_for_target(WorkspaceImeTarget::ScheduledInputTime),
                        marked_text: self
                            .marked_text_for_target(WorkspaceImeTarget::ScheduledInputTime),
                    },
                ),
                {
                    let workspace = cx.entity();
                    move |anchor, _window, cx| {
                        let _ = workspace.update(cx, |this, cx| {
                            this.update_text_input_anchor(anchor, cx);
                        });
                    }
                },
            ))
        } else {
            div()
                .flex_1()
                .min_w(px(0.0))
                .text_size(px(12.0))
                .text_color(rgb(theme.text))
                .cursor_text()
                .child(daily_label)
                .on_mouse_down(
                    MouseButton::Left,
                    cx.listener(|this, _event, window, cx| {
                        this.set_scheduled_input_time_focused(cx);
                        window.focus(&this.focus_handle, cx);
                    }),
                )
        };

        div()
            .flex()
            .items_center()
            .gap(px(6.0))
            .child(
                div()
                    .id("scheduled-input-time-decrement")
                    .size(px(28.0))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(px(self.tokens.radii.md))
                    .border_1()
                    .border_color(rgb(theme.border))
                    .cursor_pointer()
                    .child("−")
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(move |this, _event, _window, cx| {
                            if this.scheduled_input.time_focused {
                                this.commit_scheduled_input_time_draft(cx);
                            }
                            decrement(this, cx);
                            cx.stop_propagation();
                        }),
                    ),
            )
            .child(center)
            .child(
                div()
                    .id("scheduled-input-time-increment")
                    .size(px(28.0))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(px(self.tokens.radii.md))
                    .border_1()
                    .border_color(rgb(theme.border))
                    .cursor_pointer()
                    .child("+")
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(move |this, _event, _window, cx| {
                            if this.scheduled_input.time_focused {
                                this.commit_scheduled_input_time_draft(cx);
                            }
                            increment(this, cx);
                            cx.stop_propagation();
                        }),
                    ),
            )
            .into_any_element()
    }
}

fn format_daily_minute(minute: u16) -> String {
    format!("{:02}:{:02}", minute / 60, minute % 60)
}

fn parse_daily_minute(text: &str) -> Option<u16> {
    let text = text.trim();
    let (h, m) = if let Some((h, m)) = text.split_once(':') {
        (h, m)
    } else if text.len() <= 2 {
        (text, "0")
    } else {
        text.split_at(2)
    };
    let h: u16 = h.trim().parse().ok()?;
    let m: u16 = m.trim().parse().ok()?;
    if h < 24 && m < 60 {
        Some(h * 60 + m)
    } else {
        None
    }
}

fn next_daily_occurrence(minute: u16, after: DateTime<Utc>) -> Option<DateTime<Utc>> {
    let local_after = after.with_timezone(&Local);
    let start_date = local_after.date_naive();
    let time = NaiveTime::from_hms_opt(u32::from(minute / 60), u32::from(minute % 60), 0)?;

    for day_offset in 0..=8 {
        let date = start_date.checked_add_days(Days::new(day_offset))?;
        let local = NaiveDateTime::new(date, time);
        let candidate = match Local.from_local_datetime(&local) {
            LocalResult::Single(value) => Some(value),
            LocalResult::Ambiguous(first, second) => Some(first.min(second)),
            LocalResult::None => None,
        };
        if let Some(candidate) = candidate {
            let candidate = candidate.with_timezone(&Utc);
            if candidate > after {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn daily_minute_wraps_and_formats() {
        assert_eq!(format_daily_minute(0), "00:00");
        assert_eq!(format_daily_minute(23 * 60 + 45), "23:45");
    }

    #[test]
    fn parse_daily_minute_accepts_hh_mm() {
        assert_eq!(parse_daily_minute("00:00"), Some(0));
        assert_eq!(parse_daily_minute("9:30"), Some(9 * 60 + 30));
        assert_eq!(parse_daily_minute("23:59"), Some(23 * 60 + 59));
        assert_eq!(parse_daily_minute("  08:05  "), Some(8 * 60 + 5));
    }

    #[test]
    fn parse_daily_minute_rejects_invalid() {
        assert_eq!(parse_daily_minute("24:00"), None);
        assert_eq!(parse_daily_minute("12:60"), None);
        assert_eq!(parse_daily_minute("abc"), None);
    }

    #[test]
    fn next_daily_occurrence_is_strictly_after_now() {
        let now = Utc::now();
        let minute =
            (now.with_timezone(&Local).hour() * 60 + now.with_timezone(&Local).minute()) as u16;
        assert!(next_daily_occurrence(minute, now).is_some_and(|next| next > now));
    }
}
