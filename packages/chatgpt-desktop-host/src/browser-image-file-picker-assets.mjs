import {createHash} from 'node:crypto';

// This pins the exact small original module. The large composer bundle is not
// changed; original yK still checks its own attachment generation after pick.
export const IMAGE_FILE_PICKER_REFERENCE = Object.freeze({
  archiveSha256:'bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95',
  member:'webview/assets/use-file-picker-ed94b8e7bfdc.js',
  originalSha256:'16066bf92d4ea15505d1e3638be8a30c4ca6f2fdded0aee997fa16467f653d3c',
  adaptedSha256:'8baaed7a01c4ec01211bce666df1a8888493c24af2f0c5a464f228743fcefeb1',
});
const MAX_RESOURCE_BYTES = 512 * 1024;
const failure = code => Object.assign(new Error('Desktop image picker asset unavailable'), {code});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const MARKER = 'if(u?.pickFiles==null)throw Error(`File picking is not available in this host.`);';
const REPLACEMENT = 'if(typeof o===`boolean`&&c===void 0&&t===void 0&&a===void 0){if(u?.persistImageFileToTemp==null)throw Error(`Image picking is not available in this host.`);return n(__kanbanPickImage({imagesOnly:o,allowMultiple:a,persist:e=>u.persistImageFileToTemp(e)}))}'+MARKER;
const IMPORT = 'import{pickBrowserImageFiles as __kanbanPickImage}from"../__host/browser-image-file-picker.mjs";\n';

export function createBrowserImageFilePickerAssetAdapter(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => key !== 'archiveSha256') ||
      options.archiveSha256 !== IMAGE_FILE_PICKER_REFERENCE.archiveSha256)
    throw failure('IMAGE_PICKER_UNSUPPORTED_ARCHIVE');
  return Object.freeze({
    members:Object.freeze([IMAGE_FILE_PICKER_REFERENCE.member]),
    adapt({member,body} = {}) {
      if (member !== IMAGE_FILE_PICKER_REFERENCE.member) return null;
      if (!(body instanceof Uint8Array) || body.byteLength > MAX_RESOURCE_BYTES)
        throw failure('IMAGE_PICKER_INVALID_BODY');
      const original = Buffer.from(body), originalSha256=hash(original);
      if (originalSha256 !== IMAGE_FILE_PICKER_REFERENCE.originalSha256)
        throw failure('IMAGE_PICKER_DIGEST_MISMATCH');
      let source;
      try {source = new TextDecoder('utf-8',{fatal:true}).decode(original);}
      catch {throw failure('IMAGE_PICKER_PATCH_MISMATCH');}
      const at=source.indexOf(MARKER);
      if (at < 0 || at !== source.lastIndexOf(MARKER) || source.includes('__kanbanPickImage'))
        throw failure('IMAGE_PICKER_PATCH_MISMATCH');
      const adapted=Buffer.from(IMPORT+source.slice(0,at)+REPLACEMENT+source.slice(at+MARKER.length));
      if (adapted.byteLength > MAX_RESOURCE_BYTES) throw failure('IMAGE_PICKER_RESOURCE_LIMIT');
      const adaptedSha256 = hash(adapted);
      if (adaptedSha256 !== IMAGE_FILE_PICKER_REFERENCE.adaptedSha256)
        throw failure('IMAGE_PICKER_PATCH_MISMATCH');
      return {body:adapted,originalSha256,adaptedSha256};
    },
  });
}
