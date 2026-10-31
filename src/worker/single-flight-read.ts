/** Share a cold read; older completions cannot remove a newer entry. */
export class SingleFlightRead<T> {
  private readonly pending = new Map<string, Promise<T>>();

  run(key: string, load: () => Promise<T>): Promise<T> {
    const current = this.pending.get(key);
    if (current) return current;
    const promise = Promise.resolve().then(load).finally(() => {
      if (this.pending.get(key) === promise) this.pending.delete(key);
    });
    this.pending.set(key, promise);
    return promise;
  }
}
