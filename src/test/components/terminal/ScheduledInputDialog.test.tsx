import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
  listScheduledInputs: vi.fn(),
  createScheduledInput: vi.fn(),
  deleteScheduledInput: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => (
      values ? `${key}:${JSON.stringify(values)}` : key
    ),
  }),
}));

vi.mock('@/lib/api', () => ({
  api: apiMock,
}));

vi.mock('@/hooks/useToast', () => ({
  useToastStore: {
    getState: () => ({ addToast: vi.fn() }),
  },
}));

import { ScheduledInputDialog } from '@/components/terminal/ScheduledInputDialog';

describe('ScheduledInputDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.listScheduledInputs.mockResolvedValue([]);
    apiMock.createScheduledInput.mockResolvedValue({
      id: 'task-1',
      sessionId: 'session-1',
    });
    apiMock.deleteScheduledInput.mockResolvedValue(true);
  });

  it('creates one daily task with one command shared by multiple times', async () => {
    render(
      <ScheduledInputDialog
        sessionId="session-1"
        targetKind="ssh"
        buttonClassName="test-trigger"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'terminal.scheduled_input.open' }));
    fireEvent.change(screen.getByPlaceholderText('terminal.scheduled_input.command_placeholder'), {
      target: { value: 'status --compact' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'terminal.scheduled_input.add_time' }));

    const timeInputs = document.querySelectorAll('input[type="time"]');
    expect(timeInputs).toHaveLength(2);
    fireEvent.change(timeInputs[0], { target: { value: '03:00' } });
    fireEvent.change(timeInputs[1], { target: { value: '06:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'terminal.scheduled_input.save' }));

    await waitFor(() => {
      expect(apiMock.createScheduledInput).toHaveBeenCalledWith({
        sessionId: 'session-1',
        targetKind: 'ssh',
        command: 'status --compact',
        repeat: 'daily',
        onceRunAt: null,
        dailyTimes: ['03:00', '06:00'],
      });
    });
  });

  it('deletes an existing task', async () => {
    apiMock.listScheduledInputs.mockResolvedValue([{
      id: 'task-1',
      sessionId: 'session-1',
      targetKind: 'local',
      command: 'echo ready',
      repeat: 'daily',
      onceRunAt: null,
      dailyTimes: ['03:00'],
      nextRunAt: '2026-07-26T03:00:00Z',
      pending: false,
      lastRunAt: null,
      status: 'waiting',
    }]);

    render(
      <ScheduledInputDialog
        sessionId="session-1"
        targetKind="local"
      />,
    );

    await waitFor(() => expect(apiMock.listScheduledInputs).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'terminal.scheduled_input.open' }));
    fireEvent.click(await screen.findByRole('button', { name: 'terminal.scheduled_input.delete' }));

    await waitFor(() => {
      expect(apiMock.deleteScheduledInput).toHaveBeenCalledWith('task-1');
    });
  });
});
