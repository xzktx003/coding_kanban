"use strict";

const { createHash } = require("node:crypto");
const { adaptProjectConsentChunk } = require("./project-consent-routing.cjs");
const { adaptNativeSshBootstrap } = require("./ssh-bootstrap-policy.cjs");
const ORIGINAL =
  "c23f63f8ff156b2a92a81ee2870d80ab959ced6ce6232d6fe7e54bbefe11d333";
const CONSENT =
  "007f0a854dd57f5e25e8b62abe4321e4d1cdf12622a1902a983206ce418fc960";
const SSH = "275c446241ace020d7ec4215017c08970564c5d184d2d1275c504b75adf3a73d";
const COMBINED =
  "9714f7b4288b3f1df2654b5d215cbf026c05d7b7530bd86dd9f383f938e5422c";
const START = Buffer.from(
  'class eTi{options;kind="websocket";logger=(0,em.$Cz)("AppServerTransportSshWebsocket");',
);
const END = Buffer.from("}function eTs(");
const digest = (body) => createHash("sha256").update(body).digest("hex");
const failure = (code) =>
  Object.assign(new Error("Native host policy unsupported"), { code });

function section(body) {
  const begin = body.indexOf(START),
    end = body.indexOf(END, begin);
  if (
    begin < 0 ||
    end <= begin ||
    body.indexOf(START, begin + 1) !== -1 ||
    body.indexOf(END, end + 1) !== -1
  ) {
    throw failure("NATIVE_HOST_POLICY_PATCH_MISMATCH");
  }
  return { begin, end: end + 1, body: body.subarray(begin, end + 1) };
}

/** Compose only independently verified edits from the same original member. */
function adaptNativeHostChunk({ body } = {}) {
  if (!Buffer.isBuffer(body) || digest(body) !== ORIGINAL)
    throw failure("NATIVE_HOST_POLICY_DIGEST_MISMATCH");
  const consent = adaptProjectConsentChunk({ body }),
    ssh = adaptNativeSshBootstrap({ body });
  if (consent.adaptedSha256 !== CONSENT || ssh.adaptedSha256 !== SSH)
    throw failure("NATIVE_HOST_POLICY_PATCH_MISMATCH");
  const originalClass = section(body),
    baseClass = section(consent.body),
    sshClass = section(ssh.body);
  // Refuse overlaps: the other policies must leave this class unchanged, and
  // the SSH policy must leave every byte outside its exact class unchanged.
  if (
    !originalClass.body.equals(baseClass.body) ||
    !body
      .subarray(0, originalClass.begin)
      .equals(ssh.body.subarray(0, sshClass.begin)) ||
    !body.subarray(originalClass.end).equals(ssh.body.subarray(sshClass.end))
  ) {
    throw failure("NATIVE_HOST_POLICY_PATCH_MISMATCH");
  }
  const adapted = Buffer.concat([
    consent.body.subarray(0, baseClass.begin),
    sshClass.body,
    consent.body.subarray(baseClass.end),
  ]);
  if (digest(adapted) !== COMBINED)
    throw failure("NATIVE_HOST_POLICY_PATCH_MISMATCH");
  return {
    body: adapted,
    originalSha256: ORIGINAL,
    adaptedSha256: COMBINED,
    codexPolicySha256: consent.codexPolicySha256,
    consentPolicySha256: CONSENT,
    sshPolicySha256: SSH,
  };
}

module.exports = { adaptNativeHostChunk };
