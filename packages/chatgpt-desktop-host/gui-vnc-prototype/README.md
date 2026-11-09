# Opt-in GUI VNC broker prototype

This is an explicit loopback-only broker for a separately started, private graphical desktop and noVNC installation. It is not part of the default Kanban startup. It does not start, stop, log into, or manage an application or copy any account or history. The desktop launcher currently remains a separately managed private prototype; this directory does not reproduce it or contain application resources, noVNC assets, credentials, or configuration.

The caller must supply an existing canonical noVNC asset directory, an already listening owned private Unix RFB socket, and a separate randomly generated 64-character lowercase hexadecimal broker token file. The token file must be owned `0600`; both the token and socket parent directories must be owned and inaccessible to other users, and the socket must also be private. A separate VNC password remains necessary. Changed token or socket identities reject new access; established connections are not automatically revoked. The broker holds at most four connections and bounds message/transport buffers at 8 MiB.

After installing the workspace's locked dependencies, start the broker explicitly with machine-local values, for example:

```sh
export GUI_NOVNC_ROOT=/absolute/path/to/novnc
export GUI_RFB_SOCKET=/absolute/private/directory/rfb.sock
export GUI_BROKER_TOKEN_FILE=/absolute/private/directory/broker-token
export GUI_BROKER_PORT=12345 # choose an unused loopback port
node packages/chatgpt-desktop-host/gui-vnc-prototype/broker.mjs
```

The broker provides `/vnc/vnc.html` and `/vnc/websockify` on `127.0.0.1` only. Its upstream HTTPS proxy must perform the application's user authentication and WebSocket Origin validation, and inject the secret `X-CG-GUI-Broker-Token` request header server-side for both HTTP and WebSocket requests. Do not expose the broker or RFB socket directly to a LAN, put credentials in URLs or source control, or send the token to the browser. VNC authentication is independent of the broker token. A deployment must separately supply and authorize the desktop, working directory, fonts, private configuration and external proxy.

The migration's direct regression uses a private synthetic RFB socket; it does not claim that this new broker has been deployed to the currently running GUI instance:

```sh
node --test packages/chatgpt-desktop-host/test/gui-vnc-broker.test.mjs
```

The fixed noVNC 1.3.0-2 / x11vnc compatibility path is separately opt-in:

```sh
export GUI_VNC_UTF8_CLIPBOARD=1
node packages/chatgpt-desktop-host/gui-vnc-prototype/broker.mjs
```

This verifies `core/rfb.js` SHA-256 `331109966c80bef620bcd09242d43dbc05fa83cb44eba439ad20148f86aa479e` before opening a listener. A different version is rejected; the asset files are never modified. Only that script is served from an adapted in-memory copy. Notify-capable servers retain the original Notify/request path. For the tested x11vnc Text/Provide-without-Notify capabilities, the adapter sends UTF-8 bytes through the existing authenticated ClientCutText connection instead of truncating UTF-16 to eight bits. Its text cap is the advertised maximum or 1 MiB, whichever is smaller, including a reserved native NUL; invalid surrogates and embedded NUL are rejected. It preserves line breaks and does not synthesize paste, Enter, model sends or other keys. VNC password authentication remains independent and mandatory.

Users still open the original noVNC Clipboard panel, enter text, commit the panel change, then explicitly focus the remote input and paste. The native character-key input route can exhaust X11 keycodes and is not a reliable replacement for long Unicode text. A synthetic, unauthenticated Xvfb/Gtk fixture verified distinct 734-byte text including 200 different CJK characters, emoji and a newline, using the adapted original noVNC encoder, native clipboard reads, and explicit Ctrl+V into a fresh empty text view. This is local input evidence, not a real model or deployed account claim.

```sh
node --test packages/chatgpt-desktop-host/test/gui-vnc-clipboard.test.mjs packages/chatgpt-desktop-host/test/gui-vnc-broker.test.mjs
```
