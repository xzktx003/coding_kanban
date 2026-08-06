interface ClosableServer {
  close(): Promise<unknown>;
}

interface ShutdownProcess {
  once(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  removeListener(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  exit(code: number): unknown;
}

interface GracefulShutdownOptions {
  app: ClosableServer;
  processTarget?: ShutdownProcess;
  logError?: (error: unknown) => void;
}

export function installGracefulShutdown({
  app,
  processTarget = process,
  logError = () => {},
}: GracefulShutdownOptions): () => void {
  let shuttingDown = false;

  const uninstall = () => {
    processTarget.removeListener("SIGINT", onSignal);
    processTarget.removeListener("SIGTERM", onSignal);
  };

  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    try {
      await app.close();
      uninstall();
      processTarget.exit(0);
    } catch (error) {
      logError(error);
      uninstall();
      processTarget.exit(1);
    }
  };

  const onSignal = () => {
    void shutdown();
  };

  processTarget.once("SIGINT", onSignal);
  processTarget.once("SIGTERM", onSignal);

  return uninstall;
}
