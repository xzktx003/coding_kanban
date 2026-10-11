export type NativeGithubPullRequest = {
  hostname: string;
  owner: string;
  repository: string;
  number: number;
};
export type NativeGithubData = {
  title: string;
  status: "draft" | "open" | "closed" | "merged";
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
/** Native xni/eb: HTTPS github.com only; additional PR path segments are allowed. */
export function nativeGithubPullRequest(
  href: string,
): NativeGithubPullRequest | null {
  try {
    const u = new URL(href),
      parts = u.pathname.split("/").filter(Boolean);
    if (
      u.origin !== "https://github.com" ||
      u.username ||
      u.password ||
      parts[2] !== "pull" ||
      !/^\d+$/u.test(parts[3]?.trim() ?? "")
    )
      return null;
    const owner = decodeURIComponent(parts[0] ?? ""),
      repository = decodeURIComponent(parts[1] ?? ""),
      number = Number(parts[3]);
    return /^[\w.-]+$/u.test(owner) &&
      /^[\w.-]+$/u.test(repository) &&
      Number.isSafeInteger(number) &&
      number > 0
      ? { hostname: u.hostname, owner, repository, number }
      : null;
  } catch {
    return null;
  }
}
const validUrl = (v: unknown): v is string => {
  if (typeof v !== "string") return false;
  try {
    new URL(v);
    return true;
  } catch {
    return false;
  }
};
function matches(href: string, target: NativeGithubPullRequest): boolean {
  try {
    const u = new URL(href),
      p = u.pathname.split("/").filter(Boolean);
    return (
      u.hostname.toLowerCase().replace(/\.+$/u, "") ===
        target.hostname.toLowerCase().replace(/\.+$/u, "") &&
      decodeURIComponent(p[0] ?? "").toLowerCase() ===
        target.owner.toLowerCase() &&
      decodeURIComponent(p[1] ?? "").toLowerCase() ===
        target.repository.toLowerCase() &&
      p[2] === "pull" &&
      Number(p[3]) === target.number
    );
  } catch {
    return false;
  }
}
const user = (v: unknown) =>
  record(v) &&
  typeof v.login === "string" &&
  v.login.length > 0 &&
  ["avatar_url", "name"].every((k) => v[k] == null || typeof v[k] === "string");
/** Native YD/LRt schemas. Optional fields must still have the native field type. */
function validInfo(v: Record<string, unknown>, fetch: boolean): boolean {
  if (
    typeof v.title !== "string" ||
    typeof v.draft !== "boolean" ||
    typeof v.merged !== "boolean" ||
    typeof v.state !== "string" ||
    !Number.isInteger(v.number) ||
    Number(v.number) <= 0 ||
    !["OPEN", "CLOSED", "MERGED", "open", "closed", "merged"].includes(
      String(v.state),
    )
  )
    return false;
  if (fetch) {
    if (
      !record(v.base) ||
      typeof v.base.ref !== "string" ||
      !record(v.head) ||
      typeof v.head.ref !== "string" ||
      typeof v.head.sha !== "string" ||
      !v.head.sha ||
      !(
        v.head.repo === null ||
        (record(v.head.repo) && validUrl(v.head.repo.html_url))
      ) ||
      !validUrl(v.html_url)
    )
      return false;
  } else if (typeof v.base !== "string" || typeof v.head !== "string")
    return false;
  for (const k of ["body", "created_at", "merged_at", "updated_at"])
    if (v[k] != null && typeof v[k] !== "string") return false;
  for (const k of ["additions", "changed_files", "deletions"])
    if (v[k] != null && (!Number.isInteger(v[k]) || Number(v[k]) < 0))
      return false;
  if (v.mergeable != null && typeof v.mergeable !== "boolean") return false;
  if (
    v.head_sha !== undefined &&
    (typeof v.head_sha !== "string" || !v.head_sha)
  )
    return false;
  if (
    v.head_repository != null &&
    (!record(v.head_repository) || !validUrl(v.head_repository.html_url))
  )
    return false;
  if (v.url != null && !validUrl(v.url)) return false;
  if (v.user != null && !user(v.user)) return false;
  if (
    v.requested_reviewers != null &&
    (!Array.isArray(v.requested_reviewers) ||
      !v.requested_reviewers.every((x) => typeof x === "string" || user(x)))
  )
    return false;
  for (const k of fetch
    ? ["requested_team_reviewers", "requested_teams"]
    : ["requested_team_reviewers"])
    if (
      v[k] != null &&
      (!Array.isArray(v[k]) ||
        !v[k].every(
          (x) =>
            typeof x === "string" ||
            (record(x) &&
              ["name", "slug"].every(
                (n) => x[n] === undefined || typeof x[n] === "string",
              )),
        ))
    )
      return false;
  return true;
}
/** Structured results only; keep a copied display title, never REST bodies or descriptions. */
export function nativeGithubResult(
  value: unknown,
  target: NativeGithubPullRequest,
  method: "info" | "fetch" = "info",
): NativeGithubData | null {
  if (record(value) && record(value.structuredContent)) {
    const wrapped = value.structuredContent;
    if (Array.isArray(wrapped.content) && typeof wrapped.isError === "boolean")
      value = {
        content: wrapped.content,
        structuredContent: wrapped.structuredContent,
        ...("isError" in value ? { isError: wrapped.isError } : {}),
      };
  }
  if (
    !record(value) ||
    value.isError === true ||
    !record(value.structuredContent)
  )
    return null;
  let v = value.structuredContent;
  if (method === "fetch") {
    if (typeof v.content !== "string") return null;
    try {
      const parsed: unknown = JSON.parse(v.content);
      if (!record(parsed)) return null;
      v = parsed;
    } catch {
      return null;
    }
  }
  if (!validInfo(v, method === "fetch") || v.number !== target.number)
    return null;
  const url = method === "fetch" ? v.html_url : v.url;
  if (typeof url === "string" && !matches(url, target)) return null;
  // Transport projection budget: GitHub titles are not subject to Slack's 200-char limit.
  if ((v.title as string).length > 4096) return null;
  const state = String(v.state).toLowerCase();
  return {
    title: Array.from(v.title as string).join(""),
    status:
      v.merged || state === "merged"
        ? "merged"
        : state === "closed"
          ? "closed"
          : v.draft
            ? "draft"
            : "open",
  };
}

/** Strict bounded HTTP projection; do not reinterpret arbitrary tool text as a PR. */
export function nativeGithubDisplayData(
  value: unknown,
): NativeGithubData | null {
  if (
    !record(value) ||
    typeof value.title !== "string" ||
    value.title.length > 4096 ||
    typeof value.status !== "string" ||
    !["draft", "open", "closed", "merged"].includes(value.status)
  )
    return null;
  return {
    title: Array.from(value.title).join(""),
    status: value.status as NativeGithubData["status"],
  };
}
