import { AcpSessionList } from '@session/components/acp/AcpSessionList';
import { SessionList } from '@session/components/cc/session';
import { ThreadList } from '@session/components/codex/thread/ThreadList';
import { useCCSessionManager } from '@session/hooks/useCCSessionManager';
import { SideBarProjectList } from './SideBarProjectList';

type SideBarClaudeTabProps = {
  onStartNewSession: (directory: string) => void;
};

export function SideBarClaudeTab({ onStartNewSession }: SideBarClaudeTabProps) {
  const { handleSessionSelect } = useCCSessionManager();

  return (
    <SideBarProjectList
      onNewAction={onStartNewSession}
      newActionTitle={(name) => `Start new session in ${name}`}
      renderList={(directory) => (
        <SessionList directory={directory} onSelectSession={handleSessionSelect} />
      )}
    />
  );
}

type SideBarCodexTabProps = {
  onCreateNewThread: (project: string) => void;
};

export function SideBarCodexTab({ onCreateNewThread }: SideBarCodexTabProps) {
  return (
    <SideBarProjectList
      onNewAction={onCreateNewThread}
      newActionTitle={(name) => `Start new thread in ${name}`}
      renderList={(project) => <ThreadList cwd={project} />}
    />
  );
}

type SideBarAcpTabProps = {
  onStartNewSession: (directory: string) => void;
};

export function SideBarAcpTab({ onStartNewSession }: SideBarAcpTabProps) {
  return (
    <SideBarProjectList
      onNewAction={onStartNewSession}
      newActionTitle={(name) => `Start new ACP session in ${name}`}
      renderList={(project) => <AcpSessionList directory={project} />}
    />
  );
}
