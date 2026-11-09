import { createHash } from 'node:crypto';

// noVNC 1.3.0-2, shipped with the independently supplied GUI assets.
export const FIXED_NOVNC_RFB_SHA256 = '331109966c80bef620bcd09242d43dbc05fa83cb44eba439ad20148f86aa479e';
const unsupported = () => Error('NOVNC_CLIPBOARD_SOURCE_UNSUPPORTED');

// Inserted into the fixed RFB class below; its identifiers are the original
// module's constants/helpers. It changes no socket authentication or key input.
export function clipboardPasteFrom(text) {
    if (this._rfbConnectionState !== 'connected' || this._viewOnly) { return; }

    if (this._clipboardServerCapabilitiesFormats[extendedClipboardFormatText] &&
        this._clipboardServerCapabilitiesActions[extendedClipboardActionNotify]) {

        this._clipboardText = text;
        RFB.messages.extendedClipboardNotify(this._sock, [extendedClipboardFormatText]);
    } else if (this._clipboardServerCapabilitiesFormats[extendedClipboardFormatText] &&
               this._clipboardServerCapabilitiesActions[extendedClipboardActionProvide]) {
        // Fixed x11vnc accepts UTF8 through its legacy selection callback. Its
        // default UTF8/Provide callback does not update the X11 selection.
        // Keep this compatibility path bounded by the advertised text cap.
        const maximum = this._cgClipboardUnsolicitedTextMaximum;
        if (typeof text !== 'string' || text.length >= 1024 * 1024 ||
            !Number.isInteger(maximum) || maximum <= 0 || text.includes('\0')) {
            throw new RangeError('UTF8 clipboard is unavailable or exceeds its limit');
        }
        // Validate UTF16 before the original encodeUTF8 helper. Reserve the
        // trailing native NUL while preserving the supplied line breaks.
        const normalized = text;
        let bytes = 1;
        for (let i = 0; i < normalized.length; i++) {
            const value = normalized.charCodeAt(i);
            if (value >= 0xd800 && value <= 0xdbff) {
                const low = normalized.charCodeAt(++i);
                if (!(low >= 0xdc00 && low <= 0xdfff)) throw new RangeError('UTF8 clipboard contains invalid text');
                bytes += 4;
            } else if (value >= 0xdc00 && value <= 0xdfff) {
                throw new RangeError('UTF8 clipboard contains invalid text');
            } else {
                bytes += value <= 0x7f ? 1 : value <= 0x7ff ? 2 : 3;
            }
        }
        if (bytes > Math.min(maximum, 1024 * 1024)) {
            throw new RangeError('UTF8 clipboard exceeds its limit');
        }
        const encoded = encodeUTF8(text);
        const data = new Uint8Array(encoded.length);
        for (let i = 0; i < encoded.length; i++) data[i] = encoded.charCodeAt(i);
        RFB.messages.clientCutText(this._sock, data);
    } else {
        let data = new Uint8Array(text.length);
        for (let i = 0; i < text.length; i++) {
            // Preserve the original legacy-only server behavior.
            data[i] = text.charCodeAt(i);
        }
        RFB.messages.clientCutText(this._sock, data);
    }
}

export function patchFixedNoVncClipboard(bytes) {
    if (!Buffer.isBuffer(bytes) || createHash('sha256').update(bytes).digest('hex') !== FIXED_NOVNC_RFB_SHA256) throw unsupported();
    let source = bytes.toString('utf8');
    const start = source.indexOf('    clipboardPasteFrom(text) {');
    const end = source.indexOf('\n    // ===== PRIVATE METHODS =====', start);
    const capsReset = '                this._clipboardServerCapabilitiesFormats = {};\n                this._clipboardServerCapabilitiesActions = {};';
    const capsSize = "                        // We don't send unsolicited clipboard, so we\n                        // ignore the size\n                        this._sock.rQshift32();";
    if (start < 0 || end < start || source.indexOf('    clipboardPasteFrom(text) {', start + 1) !== -1 ||
        source.split(capsReset).length !== 2 || source.split(capsSize).length !== 2) throw unsupported();
    const method = clipboardPasteFrom.toString().replace(/^function /, '');
    source = source.slice(0, start) + '    ' + method + '\n' + source.slice(end);
    source = source.replace(capsReset, capsReset + '\n                this._cgClipboardUnsolicitedTextMaximum = 0;');
    source = source.replace(capsSize, '                        const maximum = this._sock.rQshift32();\n                        if (index === extendedClipboardFormatText) {\n                            this._cgClipboardUnsolicitedTextMaximum = maximum;\n                        }');
    return Buffer.from(source, 'utf8');
}
