import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  downloadWorkspaceFile,
  uploadWorkspaceFile,
  resolveWorkspaceFileReference,
  readWorkspaceText,
} from "./workspaceFiles";
import { postJsonWithOptions } from "./apiAdapt/shared";

vi.mock("@session/hooks/runtime", () => ({
  authHeaders: () => ({ Authorization: "Bearer test-token" }),
  buildEventUrl: (path: string) => `event:${path}`,
  buildUrl: (path: string) => `fetch:${path}`,
}));

vi.mock("./apiAdapt/shared", () => ({
  postJsonWithOptions: vi.fn(),
}));

class FakeUploadTarget {
  onprogress: ((event: ProgressEvent) => void) | null = null;
}

class FakeXMLHttpRequest {
  static instances: FakeXMLHttpRequest[] = [];
  headers: Record<string, string> = {};
  method = "";
  url = "";
  body: FormData | null = null;
  responseText = "";
  status = 0;
  upload = new FakeUploadTarget();
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  aborted = false;

  constructor() {
    FakeXMLHttpRequest.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  send(body: FormData) {
    this.body = body;
  }

  abort() {
    this.aborted = true;
    this.onabort?.();
  }
}

describe("workspaceFiles transfer helpers", () => {
  const originalXHR = globalThis.XMLHttpRequest;

  beforeEach(() => {
    FakeXMLHttpRequest.instances = [];
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    vi.spyOn(document.body, "appendChild");
    vi.spyOn(document.body, "removeChild");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalXHR) globalThis.XMLHttpRequest = originalXHR;
  });

  test("download asks for metadata and streams through a native anchor without buffering a blob", async () => {
    vi.mocked(postJsonWithOptions).mockResolvedValue({
      path: "/repo/dist",
      filename: "dist.zip",
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const createObjectUrl = vi.spyOn(URL, "createObjectURL");
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    await downloadWorkspaceFile("/repo", "/repo/dist");

    expect(postJsonWithOptions).toHaveBeenCalledWith(
      "/workspace-files/download-info",
      { root: "/repo", path: "/repo/dist" },
      { suppressToast: true },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalledOnce();
    const anchor = vi
      .mocked(document.body.appendChild)
      .mock.calls.find(([node]) => node instanceof HTMLAnchorElement)?.[0] as
      | HTMLAnchorElement
      | undefined;
    expect(anchor?.download).toBe("dist.zip");
    expect(anchor?.target).toBe("_blank");
    expect(anchor?.rel).toBe("noopener");
    expect(anchor?.href).toContain(
      "event:/workspace-files/download?root=%2Frepo&path=%2Frepo%2Fdist",
    );
  });

  test("upload reports progress and lets callers cancel with an AbortSignal", async () => {
    const progress = vi.fn();
    const controller = new AbortController();
    const promise = uploadWorkspaceFile(
      "/repo",
      "/repo/a.txt",
      new File(["hello"], "a.txt"),
      undefined,
      { signal: controller.signal, onProgress: progress },
    );
    const xhr = FakeXMLHttpRequest.instances[0];
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("fetch:/workspace-files/upload");
    expect(xhr.headers.Authorization).toBe("Bearer test-token");
    xhr.upload.onprogress?.(
      new ProgressEvent("progress", {
        lengthComputable: true,
        loaded: 5,
        total: 10,
      }),
    );
    expect(progress).toHaveBeenCalledWith(50);

    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(xhr.aborted).toBe(true);
  });

  test("cross-project links and their reads use the local file endpoint", async () => {
    vi.mocked(postJsonWithOptions)
      .mockResolvedValueOnce({ root: "/", path: "/other/source.ts" })
      .mockResolvedValueOnce({ content: "ok", version: "v" });
    expect(
      await resolveWorkspaceFileReference("/project", "/other/source.ts"),
    ).toEqual({ root: "/", path: "/other/source.ts" });
    await readWorkspaceText("/", "/other/source.ts");
    expect(postJsonWithOptions).toHaveBeenCalledWith(
      "/local-files/resolve",
      { root: "/project", path: "/other/source.ts" },
      { suppressToast: true },
    );
    expect(postJsonWithOptions).toHaveBeenCalledWith(
      "/local-files/read",
      { root: "/", path: "/other/source.ts" },
      { suppressToast: true },
    );
  });
  test("a project symlink denied by the project resolver is resolved through the local endpoint", async () => {
    vi.mocked(postJsonWithOptions)
      .mockReset()
      .mockRejectedValueOnce({ status: 403 })
      .mockResolvedValueOnce({ root: "/", path: "/outside/target" });
    expect(
      await resolveWorkspaceFileReference("/project", "/project/link"),
    ).toEqual({ root: "/", path: "/outside/target" });
    expect(postJsonWithOptions).toHaveBeenNthCalledWith(
      1,
      "/workspace-files/resolve",
      { root: "/project", path: "/project/link" },
      { suppressToast: true },
    );
    expect(postJsonWithOptions).toHaveBeenNthCalledWith(
      2,
      "/local-files/resolve",
      { root: "/project", path: "/project/link" },
      { suppressToast: true },
    );
  });
  test("relative links can resolve through a parent directory outside the project", async () => {
    vi.mocked(postJsonWithOptions)
      .mockReset()
      .mockResolvedValueOnce({ root: "/", path: "/other/source.ts" });
    expect(
      await resolveWorkspaceFileReference("/project", "../other/source.ts"),
    ).toEqual({ root: "/", path: "/other/source.ts" });
    expect(postJsonWithOptions).toHaveBeenCalledWith(
      "/local-files/resolve",
      { root: "/project", path: "../other/source.ts" },
      { suppressToast: true },
    );
  });
  test("local uploads and downloads use local transfer routes", async () => {
    vi.mocked(postJsonWithOptions).mockResolvedValue({
      path: "/outside/file",
      filename: "file",
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    await downloadWorkspaceFile("/", "/outside/file");
    expect(postJsonWithOptions).toHaveBeenCalledWith(
      "/local-files/download-info",
      { root: "/", path: "/outside/file" },
      { suppressToast: true },
    );
    const anchor = vi
      .mocked(document.body.appendChild)
      .mock.calls.find(
        ([node]) => node instanceof HTMLAnchorElement,
      )?.[0] as HTMLAnchorElement;
    expect(anchor.href).toContain("event:/local-files/download?");
    const upload = uploadWorkspaceFile(
      "/",
      "/outside/file2",
      new File(["x"], "file2"),
    );
    const xhr = FakeXMLHttpRequest.instances.at(-1)!;
    expect(xhr.url).toBe("fetch:/local-files/upload");
    xhr.status = 200;
    xhr.responseText = "{}";
    xhr.onload?.();
    await upload;
    expect(click).toHaveBeenCalledOnce();
  });
});
