import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createToastNotifications,
  TOAST_ERROR_DURATION_MS,
  TOAST_EXIT_DURATION_MS,
  TOAST_NOTICE_DURATION_MS,
  TOAST_SEVERITY_RANK,
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

  it('orders severities info < warning < error < fatal', () => {
    expect(TOAST_SEVERITY_RANK.info).toBeLessThan(TOAST_SEVERITY_RANK.warning);
    expect(TOAST_SEVERITY_RANK.warning).toBeLessThan(TOAST_SEVERITY_RANK.error);
    expect(TOAST_SEVERITY_RANK.error).toBeLessThan(TOAST_SEVERITY_RANK.fatal);
  });

  it('keeps multiple channels in a dismissible vertical-stack model', () => {
    const toast = createToastNotifications();
    toast.setNotice('第一条。');
    toast.setWarning('第二条。');
    toast.setError('第三条。');

    const stack = toast.getSnapshot().renderedStack;
    expect(stack.map(({ text }) => text)).toEqual([
      '第三条。',
      '第二条。',
      '第一条。',
    ]);
    expect(new Set(stack.map(({ id }) => id)).size).toBe(3);

    const warning = stack.find(({ kind }) => kind === 'warning');
    expect(warning).toBeDefined();
    toast.dismissToast(warning!.id);
    expect(toast.getSnapshot().warning).toBeNull();
    expect(
      toast.getSnapshot().renderedStack.find(({ id }) => id === warning!.id)
        ?.closing,
    ).toBe(true);

    toast.finishExit(warning!.id);
    expect(toast.getSnapshot().renderedStack.map(({ text }) => text)).toEqual([
      '第三条。',
      '第一条。',
    ]);
    toast.dispose();
  });

  it('expires same-kind entries independently', () => {
    const toast = createToastNotifications();
    toast.setNotice('较早提示。');
    vi.advanceTimersByTime(1_000);
    toast.setNotice('较晚提示。');

    vi.advanceTimersByTime(TOAST_NOTICE_DURATION_MS - 1_000);
    const stack = toast.getSnapshot().renderedStack;
    expect(stack.find(({ text }) => text === '较早提示。')?.closing).toBe(true);
    expect(stack.find(({ text }) => text === '较晚提示。')?.closing).toBe(false);
    expect(toast.getSnapshot().notice).toBe('较晚提示。');
    toast.dispose();
  });

  it('renders a notice immediately and starts closing after 5s', () => {
    const toast = createToastNotifications();
    toast.setNotice('已保存。');

    expect(toast.getSnapshot()).toMatchObject({
      error: null,
      warning: null,
      notice: '已保存。',
      fatal: null,
      rendered: { kind: 'notice', text: '已保存。' },
      closing: false,
    });

    vi.advanceTimersByTime(TOAST_NOTICE_DURATION_MS);
    // Exit transition started, but the toast is still mounted while fading.
    expect(toast.getSnapshot().closing).toBe(true);
    expect(toast.getSnapshot().rendered).toMatchObject({
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
    expect(toast.getSnapshot().rendered).toMatchObject({
      kind: 'notice',
      text: '标签已添加。',
    });
    toast.dispose();
  });

  it('keeps a new message visible while an older entry finishes fading', () => {
    const toast = createToastNotifications();
    toast.setNotice('第一条。');
    toast.setNotice(null);
    expect(toast.getSnapshot().closing).toBe(true);

    toast.setNotice('第二条。');
    expect(toast.getSnapshot().closing).toBe(true);
    expect(toast.getSnapshot().rendered).toMatchObject({
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
    expect(toast.getSnapshot().rendered).toMatchObject({
      kind: 'error',
      text: '严重问题。',
    });

    toast.setError(null);
    expect(toast.getSnapshot().rendered).toMatchObject({
      kind: 'notice',
      text: '后台提示。',
    });
    expect(toast.getSnapshot().closing).toBe(true);
    toast.dispose();
  });

  it('keeps error visible when a later info notice arrives (Serpent-99lv)', () => {
    const toast = createToastNotifications();
    toast.setError('AI 分析失败。');
    toast.setNotice('搜索完成：找到 12 项。');
    expect(toast.getSnapshot().rendered).toMatchObject({
      kind: 'error',
      text: 'AI 分析失败。',
    });
    expect(toast.getSnapshot().notice).toBe('搜索完成：找到 12 项。');
    toast.dispose();
  });

  it('keeps warning visible when a later info notice arrives (Serpent-99lv)', () => {
    const toast = createToastNotifications();
    toast.setWarning('链接源不可用。');
    toast.setNotice('搜索完成：找到 3 项。');
    expect(toast.getSnapshot().rendered).toMatchObject({
      kind: 'warning',
      text: '链接源不可用。',
    });
    expect(toast.getSnapshot().notice).toBe('搜索完成：找到 3 项。');
    toast.dispose();
  });

  it('lets warning cover notice, and error cover warning', () => {
    const toast = createToastNotifications();
    toast.setNotice('info');
    toast.setWarning('warn');
    expect(toast.getSnapshot().rendered).toMatchObject({
      kind: 'warning',
      text: 'warn',
    });
    toast.setError('err');
    expect(toast.getSnapshot().rendered).toMatchObject({
      kind: 'error',
      text: 'err',
    });
    toast.dispose();
  });

  it('keeps fatal open while lower toast channels change (Serpent-99lv)', () => {
    const toast = createToastNotifications();
    toast.setFatal('开库失败。');
    toast.setError('普通错误。');
    toast.setWarning('警告。');
    toast.setNotice('提示。');
    expect(toast.getSnapshot().fatal).toBe('开库失败。');
    expect(toast.getSnapshot().rendered).toMatchObject({
      kind: 'error',
      text: '普通错误。',
    });

    toast.setError(null);
    toast.setWarning(null);
    toast.setNotice(null);
    expect(toast.getSnapshot().fatal).toBe('开库失败。');

    toast.setFatal(null);
    expect(toast.getSnapshot().fatal).toBeNull();
    toast.dispose();
  });

  it('does not auto-dismiss fatal', () => {
    const toast = createToastNotifications();
    toast.setFatal('导入失败。');
    vi.advanceTimersByTime(60_000);
    expect(toast.getSnapshot().fatal).toBe('导入失败。');
    toast.dispose();
  });

  it('dismissVisible clears only the highest visible toast channel', () => {
    const toast = createToastNotifications();
    toast.setNotice('info');
    toast.setWarning('warn');
    toast.setError('err');
    toast.dismissVisible();
    expect(toast.getSnapshot().error).toBeNull();
    expect(toast.getSnapshot().warning).toBe('warn');
    expect(toast.getSnapshot().notice).toBe('info');
    expect(toast.getSnapshot().rendered).toMatchObject({
      kind: 'warning',
      text: 'warn',
    });
    toast.dismissVisible();
    expect(toast.getSnapshot().warning).toBeNull();
    expect(toast.getSnapshot().rendered).toMatchObject({
      kind: 'notice',
      text: 'info',
    });
    toast.dispose();
  });

  it('expires one notice while an error stays visible', () => {
    const toast = createToastNotifications();
    toast.setNotice('被覆盖的提示。');
    toast.setError('仍然显示。');

    vi.advanceTimersByTime(TOAST_NOTICE_DURATION_MS);
    expect(toast.getSnapshot().notice).toBeNull();
    expect(toast.getSnapshot().rendered).toMatchObject({
      kind: 'error',
      text: '仍然显示。',
    });
    expect(toast.getSnapshot().closing).toBe(true);
    toast.dispose();
  });

  it('ignores clearing the hidden channel and repeated finishExit calls', () => {
    const toast = createToastNotifications();
    toast.setNotice('唯一提示。');

    toast.setError(null);
    expect(toast.getSnapshot().rendered).toMatchObject({
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
