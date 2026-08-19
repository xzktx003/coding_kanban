import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MobileAgentComposer } from "./MobileAgentComposer.js";

describe("MobileAgentComposer", () => {
  it("keeps only send and safe paste as the two primary actions", () => {
    const markup = renderToStaticMarkup(
      createElement(MobileAgentComposer, {
        onSendInput: () => {},
      }),
    );

    assert.match(markup, />发送<\/button>/);
    assert.match(markup, />粘贴<\/button>/);
    assert.doesNotMatch(markup, /粘贴执行/);
  });
});
