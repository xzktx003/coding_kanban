/** A local guard rejected this operation before any native mutation was invoked. */
export class MutationNotStartedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MutationNotStartedError";
  }
}
