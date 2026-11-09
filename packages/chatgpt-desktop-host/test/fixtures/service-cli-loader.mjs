const cli = new URL("../../src/service-cli.mjs", import.meta.url).href;
const fake = new URL("./service-cli-fake-api.mjs", import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (
    context.parentURL === cli &&
    specifier === "./container-host-service.mjs"
  ) {
    return { url: fake, shortCircuit: true };
  }
  return next(specifier, context);
}
