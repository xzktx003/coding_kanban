const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const LEGACY_LIMIT = 4;
const invalidLegacy = () => new Error("Invalid ChatGPT candidate legacy routes");

function validateLegacyRoutes(value) {
  if (!Array.isArray(value) || value.length > LEGACY_LIMIT) throw invalidLegacy();
  const seen = new Set();
  return Object.freeze(Array.from(value, (entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw invalidLegacy();
    const fields = Object.getOwnPropertyDescriptors(entry);
    if (Reflect.ownKeys(fields).length !== 3 ||
        !["profileId", "generation", "loopbackPort"].every(key =>
          Object.hasOwn(fields, key) && Object.hasOwn(fields[key], "value"))) throw invalidLegacy();
    const { value: profileId } = fields.profileId;
    const { value: generation } = fields.generation;
    const { value: loopbackPort } = fields.loopbackPort;
    if (typeof profileId !== "string" || !UUID.test(profileId) ||
        typeof generation !== "string" || !UUID.test(generation) ||
        !Number.isSafeInteger(loopbackPort) || loopbackPort < 1 || loopbackPort > 65535) throw invalidLegacy();
    const key = `${profileId}/${generation}`;
    if (seen.has(key)) throw invalidLegacy();
    seen.add(key);
    return Object.freeze({ profileId, generation, loopbackPort });
  }));
}

/** Server-private JSON only; never derive a destination from a request. */
export function parseChatGptCandidateLegacyRoutes(raw) {
  if (raw === undefined || raw === "") return Object.freeze([]);
  if (typeof raw !== "string" || raw.length > 4096) throw invalidLegacy();
  let value;
  try { value = JSON.parse(raw); } catch { throw invalidLegacy(); }
  return validateLegacyRoutes(value);
}

/** Apply a server-owned, loopback-only candidate route without changing existing proxies. */
export function configureChatGptCandidate(base, port, legacyRoutes = []) {
  const login = "^/__chatgpt-candidate-login(?:\\?|$)";
  const api = "^/api/chatgpt-desktop(?:/|$)";
  const resource = "^/chatgpt-desktop(?:/|$)";
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535 || !base?.server?.https) {
    throw new Error("Invalid ChatGPT candidate configuration");
  }
  const legacy = validateLegacyRoutes(legacyRoutes);
  if (legacy.some(entry => entry.loopbackPort === port)) throw invalidLegacy();
  const legacyContexts = legacy.flatMap(({ profileId, generation, loopbackPort }) =>
    ["/api/chatgpt-desktop", "/chatgpt-desktop"].map(prefix =>
      [`^${prefix}/${profileId}/${generation}(?:/|\\?|$)`, loopbackPort]));
  const proxy = base.server.proxy ?? {};
  if (Object.hasOwn(proxy, login) || Object.hasOwn(proxy, api) || Object.hasOwn(proxy, resource) ||
      legacyContexts.some(([context]) => Object.hasOwn(proxy, context))) {
    throw new Error("ChatGPT candidate proxy already configured");
  }
  // Vite/http-proxy adds internal defaults to each options object.
  const fixed = (targetPort = port) => ({
    target: `http://127.0.0.1:${targetPort}`,
    changeOrigin: false,
    xfwd: true,
    ws: true,
  });
  return {
    ...base,
    // Do not create the adjacent fallback listener; the existing instance may own it.
    plugins: (base.plugins ?? []).filter((plugin) => !plugin || plugin.name !== "http-fallback"),
    server: {
      ...base.server,
      host: "0.0.0.0",
      strictPort: true,
      proxy: {
        ...Object.fromEntries(legacyContexts.map(([context, targetPort]) => [context, fixed(targetPort)])),
        [login]: { ...fixed(), ws: false }, [api]: fixed(), [resource]: fixed(), ...proxy,
      },
    },
  };
}
