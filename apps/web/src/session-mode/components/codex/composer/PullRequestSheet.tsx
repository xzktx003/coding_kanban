import { useEffect, useState } from "react";
import {
  gitBranchInfo,
  type GitBranchInfoResponse,
} from "@session/services/apiAdapt/git";
import { toast } from "sonner";
import {
  OwnerFormSummary,
  useConversationFormField,
  useConversationOwnerForm,
} from "./conversationOwnerFormContext";
import { ComposerSheet } from "./v2/ComposerSheet";

/** GitHub compare page for the current branch. Branch slashes stay as path segments. */
export function githubCompareUrl(
  info: GitBranchInfoResponse,
  title: string,
  body: string,
) {
  const branch = info.branch
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const query = new URLSearchParams({ expand: "1", title, body });
  return `https://github.com/${encodeURIComponent(info.owner)}/${encodeURIComponent(info.repo)}/compare/${branch}?${query}`;
}

/** Open pull requests whose head is the current branch. */
export function githubMergeOptionsUrl(info: GitBranchInfoResponse) {
  const query = new URLSearchParams({
    q: `is:open head:${info.branch}`,
  });
  return `https://github.com/${encodeURIComponent(info.owner)}/${encodeURIComponent(info.repo)}/pulls?${query}`;
}

/** Pull requests whose head is the current branch, including closed ones. */
export function githubBranchPullsUrl(info: GitBranchInfoResponse) {
  const query = new URLSearchParams({ q: `head:${info.branch}` });
  return `https://github.com/${encodeURIComponent(info.owner)}/${encodeURIComponent(info.repo)}/pulls?${query}`;
}

export function MergePullRequestSheet({
  cwd,
  onClose,
}: {
  cwd: string;
  onClose: () => void;
}) {
  const owner = useConversationOwnerForm();
  const guardLink = (event: React.MouseEvent<HTMLAnchorElement>) => {
    try {
      owner?.assertCurrent();
    } catch (error) {
      event.preventDefault();
      toast.error(String(error));
    }
  };
  const [info, setInfo] = useState<GitBranchInfoResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void gitBranchInfo(cwd)
      .then((next) => {
        if (!active) return;
        setInfo(next);
        setError(null);
      })
      .catch((failure: unknown) => {
        if (!active) return;
        setInfo(null);
        setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => {
      active = false;
    };
  }, [cwd]);
  const ready = Boolean(info?.owner && info.repo && info.branch);
  return (
    <ComposerSheet
      title="合并 PR"
      description="打开 Pull Request 合并选项"
      onClose={onClose}
    >
      <OwnerFormSummary />
      {error && <p role="alert">{error}</p>}
      {!error && !info && <p role="status">正在读取分支…</p>}
      {info && !ready && <p role="status">当前目录没有 GitHub 远程仓库</p>}
      {ready && info && (
        <>
          <p>
            {info.owner}/{info.repo} · {info.branch}
          </p>
          <p>本机没有 GitHub CLI。合并在 GitHub 上完成。</p>
          <a
            onClick={guardLink}
            href={githubMergeOptionsUrl(info)}
            target="_blank"
            rel="noreferrer"
          >
            在 GitHub 上打开合并选项
          </a>
        </>
      )}
    </ComposerSheet>
  );
}

export function OpenPullRequestSheet({
  cwd,
  onClose,
}: {
  cwd: string;
  onClose: () => void;
}) {
  const owner = useConversationOwnerForm();
  const guardLink = (event: React.MouseEvent<HTMLAnchorElement>) => {
    try {
      owner?.assertCurrent();
    } catch (error) {
      event.preventDefault();
      toast.error(String(error));
    }
  };
  const [info, setInfo] = useState<GitBranchInfoResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void gitBranchInfo(cwd)
      .then((next) => {
        if (!active) return;
        setInfo(next);
        setError(null);
      })
      .catch((failure: unknown) => {
        if (!active) return;
        setInfo(null);
        setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => {
      active = false;
    };
  }, [cwd]);
  const ready = Boolean(info?.owner && info.repo && info.branch);
  return (
    <ComposerSheet
      title="在 GitHub 上打开 PR"
      description="打开与当前聊天关联的 Pull Request"
      onClose={onClose}
    >
      <OwnerFormSummary />
      {error && <p role="alert">{error}</p>}
      {!error && !info && <p role="status">正在读取分支…</p>}
      {info && !ready && <p role="status">当前目录没有 GitHub 远程仓库</p>}
      {ready && info && (
        <>
          <p>
            {info.owner}/{info.repo} · {info.branch}
          </p>
          <p>
            当前聊天没有绑定的 Pull Request 编号。这里打开当前分支的拉取请求。
          </p>
          <a
            onClick={guardLink}
            href={githubBranchPullsUrl(info)}
            target="_blank"
            rel="noreferrer"
          >
            在 GitHub 上打开 PR
          </a>
        </>
      )}
    </ComposerSheet>
  );
}

export function PullRequestSheet({
  cwd,
  draft,
  onClose,
}: {
  cwd: string;
  draft: boolean;
  onClose: () => void;
}) {
  const owner = useConversationOwnerForm();
  const guardLink = (event: React.MouseEvent<HTMLAnchorElement>) => {
    try {
      owner?.assertCurrent();
    } catch (error) {
      event.preventDefault();
      toast.error(String(error));
    }
  };
  const [info, setInfo] = useState<GitBranchInfoResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle, initializeTitle] = useConversationFormField("title");
  const [body, setBody] = useConversationFormField("body");
  useEffect(() => {
    let active = true;
    void gitBranchInfo(cwd)
      .then((next) => {
        if (!active) return;
        setInfo(next);
        initializeTitle(next.branch);
        setError(null);
      })
      .catch((failure: unknown) => {
        if (!active) return;
        setInfo(null);
        setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => {
      active = false;
    };
  }, [cwd]);
  const ready = Boolean(info?.owner && info.repo && info.branch);
  return (
    <ComposerSheet
      title={draft ? "创建草稿 PR" : "创建 PR"}
      description={
        draft ? "打开草稿 Pull Request 创建选项" : "打开 Pull Request 创建选项"
      }
      onClose={onClose}
    >
      <OwnerFormSummary />
      {error && <p role="alert">{error}</p>}
      {!error && !info && <p role="status">正在读取分支…</p>}
      {info && !ready && <p role="status">当前目录没有 GitHub 远程仓库</p>}
      {ready && info && (
        <section className="session-pr-form">
          <p className="session-pr-form-context">
            {info.owner}/{info.repo} · {info.branch}
          </p>
          <label className="session-pr-form-field">
            <span>标题</span>
            <input
              aria-label="PR 标题"
              placeholder="请输入 PR 标题"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="session-pr-form-field">
            <span>描述</span>
            <textarea
              aria-label="PR 描述"
              placeholder="补充变更背景、实现内容和验证结果"
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          <a
            className="session-pr-form-submit"
            onClick={guardLink}
            href={githubCompareUrl(info, title, body)}
            target="_blank"
            rel="noreferrer"
          >
            {draft ? "在 GitHub 上创建草稿 PR" : "在 GitHub 上创建 PR"}
          </a>
        </section>
      )}
    </ComposerSheet>
  );
}
