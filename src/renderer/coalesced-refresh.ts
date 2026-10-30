/** Keep at most one active refresh and one trailing refresh per library. */
export function createCoalescedRefresh() {
  const tasks = new Map<string, Promise<void>>();
  const pending = new Map<string, () => Promise<void>>();
  return (key: string, refresh: () => Promise<void>): Promise<void> => {
    pending.set(key, refresh);
    const active = tasks.get(key);
    if (active) return active;

    const task = Promise.resolve().then(async () => {
      try {
        while (pending.has(key)) {
          const next = pending.get(key)!;
          pending.delete(key);
          await next();
        }
      } finally {
        pending.delete(key);
        tasks.delete(key);
      }
    });
    tasks.set(key, task);
    return task;
  };
}
