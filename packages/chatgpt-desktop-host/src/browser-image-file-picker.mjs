// The original composer owns attachment generation and final attachment state.
// This adapter only obtains browser-selected bytes and returns the original
// native pickFiles descriptor after writing through the original AppHost API.
const MAX_FILES = 4;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_LABEL_LENGTH = 255;
const TEMP_PATH = /^\/(?:[^/\x00-\x1f]+\/)*codex-clipboard-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(png|jpg)$/i;
const TEXT = Object.freeze({
  unsupported: '目前只能从本机添加 PNG 或 JPEG 图片。',
  invalid: '图片格式、数量或大小不受支持：最多 4 张，每张不超过 2 MiB，总计不超过 4 MiB。',
  failed: '添加图片失败，请重新选择。',
  inactive: '当前输入框不可用，请重新选择图片。',
});

function validImage(bytes, mime) {
  if (mime === 'image/png') {
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    return bytes.length >= sig.length && sig.every((v, i) => bytes[i] === v);
  }
  return mime === 'image/jpeg' && bytes.length >= 3 &&
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}
/** One instance belongs to one current original composer capability. */
export function createBrowserImageFilePicker({window: win, captureScope, isScopeCurrent, notice} = {}) {
  if (!win?.document?.body || !win.navigator?.userActivation ||
      typeof captureScope !== 'function' || typeof isScopeCurrent !== 'function' ||
      (notice !== undefined && typeof notice !== 'function'))
    throw new Error('Invalid browser image picker configuration');
  let closed = false, pending = null, noticeNode = null, noticeTimer = null;
  // One fixed enum survives the transient alert. Never retain native error
  // text, image bytes, filenames, paths, or account/composer identities here.
  const outcome = value => {
    try { win.document.documentElement?.setAttribute('data-chatgpt-image-picker-outcome', value); }
    catch { /* Diagnostics cannot change selection or persistence. */ }
  };
  const clearNotice = () => {
    if (noticeTimer !== null) win.clearTimeout(noticeTimer);
    noticeTimer = null;
    noticeNode?.remove();
    noticeNode = null;
  };
  const show = notice ?? (text => {
    clearNotice();
    const node = win.document.createElement('div');
    node.setAttribute('role', 'alert');
    node.textContent = text;
    Object.assign(node.style, {
      position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)',
      zIndex: '2147483647', maxWidth: 'min(90vw, 500px)', padding: '10px 14px',
      borderRadius: '10px', background: '#242424', color: '#fff',
      boxShadow: '0 3px 14px #0004', font: '14px system-ui',
    });
    noticeNode = node;
    win.document.body.appendChild(node);
    noticeTimer = win.setTimeout(clearNotice, 6000);
  });
  const current = token => {
    try { return !closed && token != null && isScopeCurrent(token) === true; }
    catch { return false; }
  };
  function finish(op, value, result) {
    if (op.done) return;
    op.done = true;
    outcome(result);
    if (pending === op) pending = null;
    op.input?.remove();
    op.resolve(value);
  }
  const revoked = (op, phase) => {
    if (op.done) return true;
    if (current(op.token)) return false;
    finish(op, [], 'SCOPE_REVOKED_' + phase);
    return true;
  };
  async function consume(op, files, persist) {
    let failedOutcome = 'IMAGE_READ_FAILED';
    try {
      if (revoked(op, 'BEFORE_READ')) return;
      if (!files.length) return finish(op, [], 'CANCELLED');
      outcome('SELECTION_RECEIVED');
      if (files.length > MAX_FILES || files.some(file =>
        !file || !Number.isSafeInteger(file.size) || file.size <= 0 ||
        file.size > MAX_FILE_BYTES || !['image/png', 'image/jpeg'].includes(file.type) ||
        typeof file.arrayBuffer !== 'function') ||
        files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) {
        show(TEXT.invalid); return finish(op, [], 'INVALID_SELECTION');
      }
      const images = [];
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (revoked(op, 'AFTER_READ')) return;
        if (bytes.byteLength !== file.size || !validImage(bytes, file.type)) {
          show(TEXT.invalid); return finish(op, [], 'INVALID_SELECTION');
        }
        const label = String(file.name ?? '').replace(/[\/\\\x00-\x1f\x7f]/g, '_').slice(0, MAX_LABEL_LENGTH) || 'image';
        images.push({bytes, mimeType: file.type, label});
      }
      const descriptors = [];
      for (const image of images) {
        if (revoked(op, 'BEFORE_PERSIST')) return;
        failedOutcome = 'PERSIST_FAILED';
        outcome('PERSIST_STARTED');
        const path = await persist({bytes: image.bytes, mimeType: image.mimeType});
        if (revoked(op, 'AFTER_PERSIST')) return;
        failedOutcome = 'INVALID_NATIVE_RESULT';
        const match = typeof path === 'string' && path.length <= 4096 && TEMP_PATH.exec(path);
        if (!match || path.split('/').some(part => part === '.' || part === '..') ||
          match[1].toLowerCase() !== (image.mimeType === 'image/png' ? 'png' : 'jpg'))
          throw new Error('Invalid native result');
        descriptors.push({label:image.label, path, fsPath:path});
      }
      finish(op, descriptors, 'FILES_RETURNED');
    } catch {
      if (revoked(op, failedOutcome === 'IMAGE_READ_FAILED' ? 'DURING_READ' : 'DURING_PERSIST')) return;
      show(TEXT.failed);
      finish(op, [], failedOutcome);
    }
  }
  return Object.freeze({
    pick({imagesOnly, allowMultiple, persist} = {}) {
      let token;
      try { token = captureScope(); } catch { token = null; }
      if (closed || pending || !current(token) || win.navigator.userActivation.isActive !== true ||
          typeof persist !== 'function' || typeof imagesOnly !== 'boolean' ||
          (allowMultiple !== undefined && typeof allowMultiple !== 'boolean')) {
        if (!closed) show(TEXT.inactive);
        if (!pending) outcome('PICKER_UNAVAILABLE');
        return Promise.resolve([]);
      }
      if (!imagesOnly) show(TEXT.unsupported);
      return new Promise(resolve => {
        const op = {token, resolve, done:false, input:null}; pending = op;
        outcome('PICKER_OPEN');
        try {
          const input = win.document.createElement('input'); op.input = input;
          input.type = 'file'; input.accept = 'image/png,image/jpeg';
          input.multiple = allowMultiple !== false;
          input.setAttribute('aria-hidden','true'); input.tabIndex = -1;
          input.style.display = 'none';
          input.addEventListener('cancel', () => finish(op, [], 'CANCELLED'), {once:true});
          input.addEventListener('change', event => {
            if (op.done) return;
            input.remove();
            if (event.isTrusted !== true) { show(TEXT.inactive); return finish(op, [], 'UNTRUSTED_SELECTION'); }
            void consume(op, Array.from(input.files ?? []), persist);
          }, {once:true});
          win.document.body.appendChild(input);
          input.click();
        } catch {
          if (!op.done && current(token)) show(TEXT.failed);
          finish(op, [], 'PICKER_OPEN_FAILED');
        }
      });
    },
    dispose() { closed = true; if (pending) finish(pending, [], 'DISPOSED'); clearNotice(); },
  });
}

// The fixed original picker bundle imports this singleton. It has no native
// transport of its own and is installed/disposed by the current surface owner.
let installed = null;
export function installBrowserImageFilePicker(options) {
  if (installed) throw new Error('Browser image picker already installed');
  const picker = createBrowserImageFilePicker(options);
  installed = picker;
  return Object.freeze({dispose() { if (installed === picker) installed = null; picker.dispose(); }});
}
export function pickBrowserImageFiles(options) {
  if (!installed) return Promise.reject(new Error('Browser image picker unavailable'));
  return installed.pick(options);
}
