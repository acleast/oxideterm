// Copyright (C) 2026 AnalyseDeCircuit
// SPDX-License-Identifier: GPL-3.0-only

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Clock3, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useToastStore } from '@/hooks/useToast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type {
  ScheduledInputRepeat,
  ScheduledInputTargetKind,
  ScheduledInputTask,
} from '@/types';

type ScheduledInputDialogProps = {
  sessionId: string;
  targetKind: ScheduledInputTargetKind;
  buttonClassName?: string;
  iconClassName?: string;
};

const inputClass = cn(
  'w-full rounded-md border border-theme-border/60 bg-theme-bg px-2 text-sm text-theme-text outline-none',
  'placeholder:text-theme-text-muted focus:border-theme-accent/70',
);

function nextDefaultDateTime(): string {
  const date = new Date();
  date.setMinutes(date.getMinutes() + 5, 0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function nextDefaultDailyTime(): string {
  const date = new Date();
  date.setHours(date.getHours() + 1, 0, 0, 0);
  return `${String(date.getHours()).padStart(2, '0')}:00`;
}

export const ScheduledInputDialog: React.FC<ScheduledInputDialogProps> = ({
  sessionId,
  targetKind,
  buttonClassName,
  iconClassName,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<ScheduledInputTask[]>([]);
  const [command, setCommand] = useState('');
  const [repeat, setRepeat] = useState<ScheduledInputRepeat>('daily');
  const [onceRunAt, setOnceRunAt] = useState(nextDefaultDateTime);
  const [dailyTimes, setDailyTimes] = useState<string[]>([nextDefaultDailyTime()]);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setTasks(await api.listScheduledInputs(sessionId));
    } catch (error) {
      console.error('[ScheduledInputDialog] Failed to list tasks:', error);
    }
  }, [sessionId]);

  useEffect(() => {
    void refresh();
    const handleChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      if (!detail?.sessionId || detail.sessionId === sessionId) {
        void refresh();
      }
    };
    window.addEventListener('oxideterm:scheduled-input-changed', handleChanged);
    return () => window.removeEventListener('oxideterm:scheduled-input-changed', handleChanged);
  }, [refresh, sessionId]);

  useEffect(() => {
    const interval = window.setInterval(() => void refresh(), open ? 5_000 : 15_000);
    return () => window.clearInterval(interval);
  }, [open, refresh]);

  const sortedDailyTimes = useMemo(
    () => [...dailyTimes].sort((left, right) => left.localeCompare(right)),
    [dailyTimes],
  );

  const notifyChanged = useCallback(() => {
    window.dispatchEvent(new CustomEvent('oxideterm:scheduled-input-changed', {
      detail: { sessionId },
    }));
  }, [sessionId]);

  const handleSave = useCallback(async () => {
    if (!command.trim()) {
      useToastStore.getState().addToast({
        title: t('terminal.scheduled_input.command_required'),
        variant: 'error',
      });
      return;
    }
    if (repeat === 'once' && !onceRunAt) {
      useToastStore.getState().addToast({
        title: t('terminal.scheduled_input.time_required'),
        variant: 'error',
      });
      return;
    }
    if (repeat === 'daily' && sortedDailyTimes.some((time) => !time)) {
      useToastStore.getState().addToast({
        title: t('terminal.scheduled_input.time_required'),
        variant: 'error',
      });
      return;
    }

    setSaving(true);
    try {
      await api.createScheduledInput({
        sessionId,
        targetKind,
        command,
        repeat,
        onceRunAt: repeat === 'once' ? new Date(onceRunAt).toISOString() : null,
        dailyTimes: repeat === 'daily' ? sortedDailyTimes : [],
      });
      setCommand('');
      await refresh();
      notifyChanged();
      useToastStore.getState().addToast({
        title: t('terminal.scheduled_input.saved'),
        variant: 'success',
      });
    } catch (error) {
      console.error('[ScheduledInputDialog] Failed to create task:', error);
      useToastStore.getState().addToast({
        title: t('terminal.scheduled_input.save_failed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  }, [
    command,
    notifyChanged,
    onceRunAt,
    refresh,
    repeat,
    sessionId,
    sortedDailyTimes,
    t,
    targetKind,
  ]);

  const handleDelete = useCallback(async (taskId: string) => {
    try {
      await api.deleteScheduledInput(taskId);
      await refresh();
      notifyChanged();
    } catch (error) {
      console.error('[ScheduledInputDialog] Failed to delete task:', error);
      useToastStore.getState().addToast({
        title: t('terminal.scheduled_input.delete_failed'),
        variant: 'error',
      });
    }
  }, [notifyChanged, refresh, t]);

  const formatDateTime = useCallback((value: string) => (
    new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  ), []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            'relative text-theme-text-muted transition-colors hover:bg-theme-bg-hover hover:text-theme-accent',
            tasks.length > 0 && 'text-theme-accent',
            buttonClassName,
          )}
          title={t('terminal.scheduled_input.open')}
          aria-label={t('terminal.scheduled_input.open')}
        >
          <Clock3 className={cn('h-3.5 w-3.5', iconClassName)} />
          {tasks.length > 0 && (
            <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-theme-accent px-0.5 text-[9px] font-semibold leading-none text-white">
              {tasks.length}
            </span>
          )}
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[min(720px,90vh)] max-w-xl overflow-hidden p-0">
        <DialogHeader className="border-b border-theme-border/60 px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="h-4 w-4 text-theme-accent" />
            {t('terminal.scheduled_input.title')}
          </DialogTitle>
          <DialogDescription>
            {t('terminal.scheduled_input.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-5 py-4">
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-theme-text-muted">
                {t('terminal.scheduled_input.command')}
              </span>
              <textarea
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                rows={3}
                spellCheck={false}
                className={cn(inputClass, 'min-h-20 resize-y py-2 font-mono')}
                placeholder={t('terminal.scheduled_input.command_placeholder')}
              />
            </label>

            <div>
              <span className="mb-1.5 block text-xs font-medium text-theme-text-muted">
                {t('terminal.scheduled_input.repeat')}
              </span>
              <div className="inline-flex rounded-md border border-theme-border/60 bg-theme-bg p-0.5">
                {(['once', 'daily'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setRepeat(value)}
                    className={cn(
                      'h-7 px-3 text-xs transition-colors',
                      repeat === value
                        ? 'rounded bg-theme-accent/15 text-theme-accent'
                        : 'text-theme-text-muted hover:text-theme-text',
                    )}
                  >
                    {t(`terminal.scheduled_input.${value}`)}
                  </button>
                ))}
              </div>
            </div>

            {repeat === 'once' ? (
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-theme-text-muted">
                  {t('terminal.scheduled_input.run_at')}
                </span>
                <input
                  type="datetime-local"
                  value={onceRunAt}
                  onChange={(event) => setOnceRunAt(event.target.value)}
                  className={cn(inputClass, 'h-9 px-2')}
                />
              </label>
            ) : (
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-medium text-theme-text-muted">
                    {t('terminal.scheduled_input.daily_times')}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDailyTimes((current) => [...current, nextDefaultDailyTime()])}
                    className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-theme-accent hover:bg-theme-accent/10"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t('terminal.scheduled_input.add_time')}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {dailyTimes.map((time, index) => (
                    <div key={`${index}-${time}`} className="flex min-w-0 items-center gap-1">
                      <input
                        type="time"
                        value={time}
                        onChange={(event) => setDailyTimes((current) => (
                          current.map((item, itemIndex) => (
                            itemIndex === index ? event.target.value : item
                          ))
                        ))}
                        className={cn(inputClass, 'h-9 min-w-0 px-2')}
                      />
                      <button
                        type="button"
                        disabled={dailyTimes.length === 1}
                        onClick={() => setDailyTimes((current) => (
                          current.filter((_, itemIndex) => itemIndex !== index)
                        ))}
                        className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-theme-text-muted hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-35"
                        title={t('terminal.scheduled_input.remove_time')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="mt-5 border-t border-theme-border/60 pt-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-medium text-theme-text">
                {t('terminal.scheduled_input.tasks')}
              </h3>
              <span className="text-[11px] tabular-nums text-theme-text-muted">
                {t('terminal.scheduled_input.task_count', { count: tasks.length })}
              </span>
            </div>
            {tasks.length === 0 ? (
              <div className="py-5 text-center text-xs text-theme-text-muted">
                {t('terminal.scheduled_input.empty')}
              </div>
            ) : (
              <div className="relative border-l border-theme-border/70 pl-4">
                {tasks.map((task) => (
                  <div key={task.id} className="relative border-b border-theme-border/45 py-3 last:border-b-0">
                    <span className={cn(
                      'absolute -left-[19px] top-4 h-2 w-2 rounded-full border-2 border-theme-bg-elevated',
                      task.pending ? 'bg-amber-400' : 'bg-theme-accent',
                    )} />
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono text-xs text-theme-text" title={task.command}>
                          {task.command}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-theme-text-muted">
                          <span>{task.repeat === 'daily'
                            ? t('terminal.scheduled_input.daily_at', { times: task.dailyTimes.join(', ') })
                            : t('terminal.scheduled_input.once')}
                          </span>
                          <span className={task.pending ? 'text-amber-300' : ''}>
                            {task.pending
                              ? t('terminal.scheduled_input.pending')
                              : t('terminal.scheduled_input.next_run', { time: formatDateTime(task.nextRunAt) })}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleDelete(task.id)}
                        className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-theme-text-muted hover:bg-red-500/10 hover:text-red-300"
                        title={t('terminal.scheduled_input.delete')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="border-t border-theme-border/60 px-5 py-3">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="h-8 rounded-md px-3 text-xs text-theme-text-muted hover:bg-theme-bg-hover hover:text-theme-text"
          >
            {t('terminal.scheduled_input.close')}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="h-8 rounded-md bg-theme-accent px-3 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? t('terminal.scheduled_input.saving') : t('terminal.scheduled_input.save')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
