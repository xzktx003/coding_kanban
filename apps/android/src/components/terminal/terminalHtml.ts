// Builds a self-contained terminal HTML page for the RN WebView.
// The page renders an xterm.js terminal and bridges input/resize back to the
// RN side through window.ReactNativeWebView.postMessage. RN owns the WebSocket
// and pushes rendered output in via window.__term_output(...).

const XTERM_CSS = "https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css";
const XTERM_JS = "https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js";
const FIT_JS = "https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js";

export function buildTerminalHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link rel="stylesheet" href="${XTERM_CSS}" />
  <style>
    html, body { margin: 0; padding: 0; height: 100%; background: #0b0d12; overflow: hidden; }
    #terminal { width: 100%; height: 100%; }
    .xterm { height: 100%; padding: 4px; }
    .xterm .xterm-viewport { background-color: transparent !important; }
    #boot {
      position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
      color: #6b7484; font: 13px/1.4 system-ui, sans-serif; text-align: center; padding: 16px;
    }
  </style>
</head>
<body>
  <div id="boot">正在连接终端…</div>
  <div id="terminal"></div>
  <script src="${XTERM_JS}"></script>
  <script src="${FIT_JS}"></script>
  <script>
    (function () {
      var boot = document.getElementById("boot");
      function post(type, data) {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, data: data }));
        }
      }
      function fail(msg) {
        if (boot) { boot.textContent = msg; }
        post("error", msg);
      }
      if (!window.Terminal) { fail("终端组件加载失败（需联网加载 xterm.js）"); return; }

      var term = new window.Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: "Menlo, Consolas, 'Fira Code', monospace",
        scrollback: 2000,
        allowProposedApi: true,
        theme: { background: "#0b0d12", foreground: "#d7dce6", cursor: "#5b8cff" }
      });
      var FitAddon = window.FitAddon && window.FitAddon.FitAddon;
      try {
        if (FitAddon) { term.loadAddon(new FitAddon()); }
      } catch (e) { /* fit is optional */ }

      var fitTerminal = function () {
        try {
          if (term.fit && term._fitAddon) { /* noop */ }
        } catch (e) {}
        if (term.fit) {
          var beforeCols = term.cols;
          var beforeRows = term.rows;
          try { term.fit(); } catch (e) {}
          if (term._fitAddon && term.fit && (term.cols !== beforeCols || term.rows !== beforeRows)) {
            post("resize", { cols: term.cols, rows: term.rows });
          }
        }
      };

      term.open(document.getElementById("terminal"));
      if (boot) { boot.style.display = "none"; }
      term.onData(function (data) { post("input", data); });

      function resizeObserver() {
        try {
          if (window.ResizeObserver && term.fit) {
            var ro = new ResizeObserver(function () { try { term.fit(); post("resize", { cols: term.cols, rows: term.rows }); } catch (e) {} });
            ro.observe(document.getElementById("terminal"));
          }
        } catch (e) {}
      }
      resizeObserver();
      try { term.fit(); post("resize", { cols: term.cols, rows: term.rows }); } catch (e) {}

      // RN writes output into the terminal here.
      window.__term_output = function (data) {
        if (data) { term.write(data); }
      };
      window.__term_ready = "ready";
      post("ready", null);
    })();
  </script>
</body>
</html>`;
}
