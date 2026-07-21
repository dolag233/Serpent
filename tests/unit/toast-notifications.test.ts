import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createToastNotifications,
  TOAST_ERROR_DURATION_MS,
  TOAST_EXIT_DURATION_MS,
  TOAST_NOTICE_DURATION_MS,
} from '../../src/renderer/toast-notifications';

/** Fallback unmount fires the exit duration plus a small margin. */
const EXIT_FALLBACK_MS = TOAST_EXIT_DURATION_MS + 50;

describe('createToastNotifications', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a notice immediately and starts closing after 5s', () => {
    const toast = createToastNotifications();
    toast.setNotice('已保存。');

    expect(toast.getSnapshot()).toEqual({
      error: null,
      warning: null,
      notice: '已保存。',
      rendered: { kind: 'notice', text: '已保存。' },
      closing: false,
    });

    vi.advanceTimersByTime(TOAST_NOTICE_DURATION_MS);
    // Exit transition started, but the toast is still mounted while fading.
    expect(toast.getSnapshot().closing).toBe(true);
    expect(toast.getSnapshot().rendered).toEqual({
      kind: 'notice',
      text: '已保存。',
    });

    toast.dispose();
  });

  it('unmounts only after the exit transition ends (fallback timer)', () => {
    const toast = createToastNotifications();
    toast.setNotice('已保存。');
    vi.advanceTimersByTime(TOAST_NOTICE_DURATION_MS);

    vi.advanceTimersByTime(EXIT_FALLBACK_MS - 1);
    expect(toast.getSnapshot().rendered).not.toBeNull();

    vi.advanceTimersByTime(1);
    expect(toast.getSnapshot().rendered).toBeNull();
    expect(toast.getSnapshot().closing).toBe(false);
    toast.dispose();
  });

  it('unmounts immediately when the transitionend lifecycle finishes first', () => {
    const toast = createToastNotifications();
    toast.setError('导入失败。');
    vi.advanceTimersByTime(TOAST_ERROR_DURATION_MS);
    expect(toast.getSnapshot().closing).toBe(true);

    toast.finishExit();
    expect(toast.getSnapshot().rendered).toBeNull();
    expect(toast.getSnapshot().closing).toBe(false);

    // The fallback timer must not fire a second unmount afterwards.
    vi.advanceTimersByTime(EXIT_FALLBACK_MS + 1_000);
    expect(toast.getSnapshot().rendered).toBeNull();
    toast.dispose();
  });

  it('keeps an error visible for 10s before closing', () => {
    const toast = createToastNotifications();
    toast.setError('导入失败。');

    vi.advanceTimersByTime(TOAST_NOTICE_DURATION_MS);
    expect(toast.getSnapshot().closing).toBe(false);

    vi.advanceTimersByTime(TOAST_ERROR_DURATION_MS - TOAST_NOTICE_DURATION_MS);
    expect(toast.getSnapshot().closing).toBe(true);
    toast.dispose();
  });

  it('starts the exit transition on manual close instead of unmounting instantly', () => {
    const toast = createToastNotifications();
    toast.setNotice('标签已添加。');
    toast.setNotice(null);

    expect(toast.getSnapshot().closing).toBe(true);
    expect(toast.getSnapshot().rendered).toEqual({
      kind: 'notice',
      text: '标签已添加。',
    });
    toast.dispose();
  });

  it('cancels the exit transition when a new message arrives mid-fade', () => {
    const toast = createToastNotifications();
    toast.setNotice('第一条。');
    toast.setNotice(null);
    expect(toast.getSnapshot().closing).toBe(true);

    toast.setNotice('第二条。');
    expect(toast.getSnapshot().closing).toBe(false);
    expect(toast.getSnapshot().rendered).toEqual({
      kind: 'notice',
      text: '第二条。',
    });

    // The cancelled fallback must not unmount the new message later.
    vi.advanceTimersByTime(EXIT_FALLBACK_MS + 1_000);
    expect(toast.getSnapshot().rendered).not.toBeNull();
    toast.dispose();
  });

  it('lets an error cover a notice, then reveals the notice without a fade', () => {
    const toast = createToastNotifications();
    toast.setNotice('后台提示。');
    toast.setError('严重问题。');
    expect(toast.getSnapshot().rendered).toEqual({
      kind: 'error',
      text: '严重问题。',
    });

    toast.setError(null);
    expect(toast.getSnapshot().rendered).toEqual({
      kind: 'notice',
      text: '后台提示。',
    });
    expect(toast.getSnapshot().closing).toBe(false);
    toast.dispose();
  });

  it('keeps error visible when a later info notice arrives (Serpent-99lv)', () => {
    const toast = createToastNotifications();
    toast.setError('AI 分析失败。');
    toast.setNotice('搜索完成：找到 12 项。');
    expect(toast.getSnapshot().rendered).toEqual({
      kind: 'error',
      text: 'AI 分析失败。',
    });
    expect(toast.getSnapshot().notice).toBe('搜索完成：找到 12 项。');
    toast.dispose();
  });

  it('lets warning cover notice, and error cover warning', () => {
    const toast = createToastNotifications();
    toast.setNotice('info');
    toast.setWarning('warn');
    expect(toast.getSnapshot().rendered).toEqual({
      kind: 'warning',
      text: 'warn',
    });
    toast.setError('err');
    expect(toast.getSnapshot().rendered).toEqual({
      kind: 'error',
      text: 'err',
    });
    toast.dispose();
  });

  it('expires a hidden notice silently while an error stays visible', () => {
    const toast = createToastNotifications();
    toast.setNotice('被覆盖的提示。');
    toast.setError('仍然显示。');

    vi.advanceTimersByTime(TOAST_NOTICE_DURATION_MS);
    expect(toast.getSnapshot().notice).toBeNull();
    expect(toast.getSnapshot().rendered).toEqual({
      kind: 'error',
      text: '仍然显示。',
    });
    expect(toast.getSnapshot().closing).toBe(false);
    toast.dispose();
  });

  it('ignores clearing the hidden channel and repeated finishExit calls', () => {
    const toast = createToastNotifications();
    toast.setNotice('唯一提示。');

    toast.setError(null);
    expect(toast.getSnapshot().rendered).toEqual({
      kind: 'notice',
      text: '唯一提示。',
    });
    expect(toast.getSnapshot().closing).toBe(false);

    toast.finishExit();
    expect(toast.getSnapshot().closing).toBe(false);

    toast.setNotice(null);
    expect(toast.getSnapshot().closing).toBe(true);
    toast.finishExit();
    toast.finishExit();
    expect(toast.getSnapshot().rendered).toBeNull();
    toast.dispose();
  });

  it('notifies subscribers on every visible state change', () => {
    const toast = createToastNotifications();
    const listener = vi.fn();
    const unsubscribe = toast.subscribe(listener);

    toast.setNotice('已保存。');
    vi.advanceTimersByTime(TOAST_NOTICE_DURATION_MS);
    vi.advanceTimersByTime(EXIT_FALLBACK_MS);
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(3);

    unsubscribe();
    toast.setNotice('下一条。');
    const callsAfterUnsubscribe = listener.mock.calls.length;
    toast.setNotice(null);
    expect(listener.mock.calls.length).toBe(callsAfterUnsubscribe);
    toast.dispose();
  });
});
