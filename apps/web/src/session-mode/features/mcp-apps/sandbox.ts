type Csp = { connectDomains: string[]; resourceDomains: string[]; frameDomains: string[]; baseUriDomains: string[] };
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function normalizeMcpAppCsp(value: unknown): Csp {
  const data = record(value), output: Csp = { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] };
  for (const [name, alias] of [["connectDomains", "connect_domains"], ["resourceDomains", "resource_domains"], ["frameDomains", "frame_domains"], ["baseUriDomains", "base_uri_domains"]] as const) {
    const entries = data[name] ?? data[alias] ?? [];
    if (!Array.isArray(entries) || entries.length > 32) throw new Error("应用资源声明了无效的网络范围");
    for (const entry of entries) {
      if (typeof entry !== "string" || entry.length > 2048 || /[\s;,"'<>]/.test(entry)) throw new Error("应用资源声明了无效的网络范围");
      if (name === "resourceDomains" && ["data:", "blob:"].includes(entry)) { output[name].push(entry); continue; }
      const url = new URL(entry);
      if (!(url.protocol === "https:" || name === "connectDomains" && url.protocol === "wss:") || url.username || url.password || url.search || url.hash || url.pathname !== "/" || url.hostname === "*" || url.hostname.includes("*") && !/^\*\.[a-z0-9.-]+$/i.test(url.hostname)) throw new Error("应用资源声明了不支持的网络范围");
      output[name].push(url.origin);
    }
    output[name] = [...new Set(output[name])];
  }
  return output;
}
const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
export function mcpAppPolicy(csp: Csp) {
  const resources = csp.resourceDomains.join(" "), none = (values: string[]) => values.length ? values.join(" ") : "'none'";
  return `default-src 'none'; script-src 'unsafe-inline' ${resources}; style-src 'unsafe-inline' ${resources}; img-src data: blob: ${resources}; font-src ${resources || "'none'"}; media-src data: blob: ${resources}; connect-src ${none(csp.connectDomains)}; frame-src ${none(csp.frameDomains)}; base-uri ${none(csp.baseUriDomains)}; object-src 'none'; form-action 'none'`;
}
/** A data URL has an opaque origin distinct from the Kanban host. Only this trusted proxy receives raw app HTML. */
export function mcpAppSandboxUrl(csp: Csp) {
  const policy = mcpAppPolicy(csp), outerPolicy = policy.replace(/frame-src [^;]+/, `frame-src about: data: blob: ${csp.frameDomains.join(" ")}`);
  const proxy = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${esc(outerPolicy)}"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;overflow:hidden}</style></head><body><script>
  (()=>{let view=null,loaded=false;const policy=${JSON.stringify(policy)};window.addEventListener('message',event=>{const data=event.data;if(!data||typeof data!=='object'||Array.isArray(data)||data.jsonrpc!=='2.0')return;if(event.source===parent){if(data.method==='ui/notifications/sandbox-resource-ready'){if(loaded||typeof data.params?.html!=='string')return;loaded=true;view=document.createElement('iframe');view.title='MCP App';view.setAttribute('sandbox','allow-scripts');view.setAttribute('allow',${JSON.stringify("camera 'none'; microphone 'none'; geolocation 'none'; clipboard-write 'none'")});view.srcdoc='<meta http-equiv="Content-Security-Policy" content="'+policy.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')+'">'+data.params.html;document.body.appendChild(view);return;}if(view&&!(typeof data.method==='string'&&data.method.startsWith('ui/notifications/sandbox-')))view.contentWindow.postMessage(data,'*');}else if(view&&event.source===view.contentWindow&&event.origin==='null'&&!(typeof data.method==='string'&&data.method.startsWith('ui/notifications/sandbox-')))parent.postMessage(data,'*');});parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/sandbox-proxy-ready'},'*');})();
  </script></body></html>`;
  return "data:text/html;charset=utf-8," + encodeURIComponent(proxy);
}
