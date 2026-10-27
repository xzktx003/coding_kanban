import { deny, recordValues } from './admission.mjs';

export const EXPECTED_ORIGINAL_ASSET_HASHES = Object.freeze({
  core: '50e2af3d8c3d0e3c52612beb2d95940cc818dfe979d6d85a9fa61af5526640bc',
  native: 'c755dbca916c0f830a554fe2e3057f8642b32394bea7701338e5d506f692ad56',
  host: 'a8069de80c8f8141481d033f94c3a95e1b59f399143cb2554d3f68469dfbe5b8',
});
export function assertExecutionPermit(value) {
  const p = recordValues(value, ['kind', 'runAuthorized', 'originalPackagesMayExecute', 'authorizationId']);
  if (p.kind !== 'closed-original-rpc-synthetic-negative' || p.runAuthorized !== true ||
    p.originalPackagesMayExecute !== true || typeof p.authorizationId !== 'string' ||
    p.authorizationId.length < 1 || p.authorizationId.length > 128 || /[\x00-\x1f\x7f]/.test(p.authorizationId)) deny('execution-not-authorized');
  return Object.freeze({ ...p });
}
export function assertOriginalAssetDeclaration(value) {
  const record = recordValues(value, Object.keys(EXPECTED_ORIGINAL_ASSET_HASHES));
  for (const key of Object.keys(EXPECTED_ORIGINAL_ASSET_HASHES)) {
    if (record[key] !== EXPECTED_ORIGINAL_ASSET_HASHES[key]) deny('original-asset-declaration');
  }
  // This checks the caller's declaration only; the immutable resource loader must independently hash bytes.
  return Object.freeze({ ...record });
}
