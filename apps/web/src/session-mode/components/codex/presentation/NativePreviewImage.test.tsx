import { render, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NativePreviewImage } from "./NativePreviewImage";
afterEach(() => vi.unstubAllGlobals());
it("decodes into an owned Blob and releases each mounted image without retaining source bytes in cleanup", () => {
  const create = vi
      .fn()
      .mockReturnValueOnce("blob:first")
      .mockReturnValueOnce("blob:second"),
    revoke = vi.fn();
  const original = URL;
  vi.stubGlobal(
    "URL",
    class extends original {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  const onError = vi.fn(),
    image = { dataUrl: "data:image/png;base64,AQID", width: 20, height: 30 };
  const view = render(
    <NativePreviewImage
      image={image}
      presentation="thumbnail"
      onError={onError}
    />,
  );
  expect(create.mock.calls[0][0].size).toBe(3);
  expect(create.mock.calls[0][0].type).toBe("image/png");
  expect(view.container.querySelector("img")?.src).toBe("blob:first");
  fireEvent.error(view.container.querySelector("img")!);
  expect(onError).toHaveBeenCalledOnce();
  view.rerender(
    <NativePreviewImage
      image={{ ...image, dataUrl: "data:image/png;base64,BAUG" }}
      presentation="standalone"
      onError={onError}
    />,
  );
  expect(revoke).toHaveBeenCalledWith("blob:first");
  expect(view.container.querySelector("img")?.src).toBe("blob:second");
  view.unmount();
  expect(revoke.mock.calls).toEqual([["blob:first"], ["blob:second"]]);
});
