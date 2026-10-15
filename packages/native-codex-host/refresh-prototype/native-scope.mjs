export function validateNativeScope(scope) {
  if (
    !scope ||
    typeof scope !== "object" ||
    Array.isArray(scope) ||
    Object.keys(scope).sort().join(",") !==
      "domain,generation,pid,startTicks" ||
    typeof scope.domain !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      scope.domain,
    ) ||
    typeof scope.generation !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      scope.generation,
    ) ||
    !Number.isSafeInteger(scope.pid) ||
    scope.pid <= 1 ||
    typeof scope.startTicks !== "string" ||
    !/^(?:0|[1-9][0-9]{0,19})$/.test(scope.startTicks)
  )
    throw Error("exact native service scope required");
  return Object.freeze({
    domain: scope.domain,
    generation: scope.generation,
    pid: scope.pid,
    startTicks: scope.startTicks,
  });
}
