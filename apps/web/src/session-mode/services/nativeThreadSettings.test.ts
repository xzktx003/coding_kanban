import { expect, it } from "vitest";
import { nativeThreadSettings } from "./nativeThreadSettings";
it("preserves absent native settings and distinguishes explicit null from missing fields", () => {
  expect(nativeThreadSettings({ model:"owner", reasoningEffort:undefined, serviceTier:null }, { reasoningEffort:"high",serviceTier:"fast",approvalPolicy:"on-request" })).toMatchObject({model:"owner",reasoningEffort:"high",serviceTier:null,approvalPolicy:"on-request"});
  expect(nativeThreadSettings({ model:"owner", effort:null,sandbox:{type:"readOnly",networkAccess:false} })).toMatchObject({reasoningEffort:null,sandboxPolicy:{type:"readOnly",networkAccess:false}});
  expect(nativeThreadSettings({threadId:"foreign",input:["no"],modelProvider:""})).toEqual({});
});
