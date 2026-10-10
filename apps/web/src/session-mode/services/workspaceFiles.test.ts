import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { downloadWorkspaceFile, uploadWorkspaceFile } from "./workspaceFiles";
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
});
