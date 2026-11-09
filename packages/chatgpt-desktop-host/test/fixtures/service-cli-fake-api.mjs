import { writeFile } from "node:fs/promises";

export async function reattachContainerDesktopService() {
  throw Error("This fixture must never recover a native process");
}

// Models only the manager's reference to a native liveness monitor. This test
// fixture never starts a native process, opens IPC or reads an account.
export async function startContainerDesktopService(options) {
  setInterval(() => {}, 1000);
  return {
    profileId: "11111111-1111-4111-8111-111111111111",
    generation: "22222222-2222-4222-8222-222222222222",
    nativeExited: new Promise(() => {}),
    async close() {
      await writeFile(options.profileFile + ".fake-close", "completed", {
        flag: "wx",
        mode: 0o600,
      });
      if (process.env.CHATGPT_FAKE_CLOSE_UNKNOWN === "1")
        throw Error("unknown close");
    },
  };
}
