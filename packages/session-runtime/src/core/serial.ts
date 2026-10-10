/** Per-resource serialization; rejected work never poisons the next operation. */
export class KeyedSerial {
  private tails = new Map<string, Promise<unknown>>();
  busy(key: string): boolean { return this.tails.has(key); }
  run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const work = (this.tails.get(key) ?? Promise.resolve()).then(operation);
    const tail = work.catch(() => undefined).finally(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    this.tails.set(key, tail);
    return work;
  }
}
