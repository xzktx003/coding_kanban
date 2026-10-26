// Ordinary Code Full Access content from original Permissions.Ht/Ut (26.51007).
// Cyber/ChatGPT/policy branches and native permission admission are outside this dialog.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@session/components/ui/dialog";
import { openUrl } from "@session/browser-opener";
import "./native-full-access-confirmation.css";

const FULL_ACCESS_DOCUMENTATION =
  "https://developers.openai.com/codex/concepts/sandboxing#how-you-control-it";

// Exact ordinary isCyberModel=false text, including the space before <link>.
const messages = {
  "zh": {
    "warningTitle": "要开启完整访问权限吗？",
    "warningDescription.codeMode": "Codex 将能够在未经您许可的情况下，在这台计算机上的任何位置运行命令、使用互联网，以及创建和编辑文件。这包括但不限于：",
    "files.title": "文件和文件夹",
    "files.description": "读取、创建、修改、上传或删除此计算机上任意位置的文件",
    "terminal.title": "终端命令",
    "terminal.description": "运行命令、安装软件和更改系统设置",
    "internet.title": "互联网和已连接的应用",
    "internet.description": "访问网站、发送数据并使用已启用的插件",
    "ordinaryRiskBeforeLink": "这会带来敏感数据丢失或泄露、提示注入等风险。你可以将其关闭。 ",
    "learnMore": "了解更多",
    "ordinaryRiskAfterLink": "",
    "goBack": "取消",
    "turnOnButton": "确认"
  },
  "ja": {
    "warningTitle": "フルアクセスをオンにしますか？",
    "warningDescription.codeMode": "Codex は、あなたの許可なく、このコンピューター上のどこでもコマンドを実行し、インターネットを使用し、ファイルを作成・編集できるようになります。これには以下が含まれますが、これらに限定されません:",
    "files.title": "ファイルとフォルダー",
    "files.description": "このコンピューター上の任意の場所にあるファイルを読み取り、作成、変更、アップロード、削除する",
    "terminal.title": "ターミナルコマンド",
    "terminal.description": "コマンドの実行、ソフトウェアのインストール、システム設定の変更",
    "internet.title": "インターネットと連携アプリ",
    "internet.description": "ウェブサイトにアクセスし、データを送信し、有効なプラグインを使用する",
    "ordinaryRiskBeforeLink": "これには、機密データの損失や漏洩、プロンプトインジェクションなどのリスクがあります。これはオフにできます。 ",
    "learnMore": "詳細を見る",
    "ordinaryRiskAfterLink": "",
    "goBack": "キャンセルする",
    "turnOnButton": "確認"
  },
  "fr": {
    "warningTitle": "Activer l’accès complet ?",
    "warningDescription.codeMode": "Codex pourra exécuter des commandes, utiliser Internet, créer et modifier des fichiers n’importe où sur cet ordinateur sans votre autorisation. Cela inclut notamment :",
    "files.title": "Fichiers et dossiers",
    "files.description": "Lire, créer, modifier, télécharger ou supprimer des fichiers n’importe où sur cet ordinateur",
    "terminal.title": "Commandes du terminal",
    "terminal.description": "Exécuter des commandes, installer des logiciels et modifier les paramètres système",
    "internet.title": "Internet et applications connectées",
    "internet.description": "Accéder aux sites web, envoyer des données et utiliser les plugins activés",
    "ordinaryRiskBeforeLink": "Cela comporte des risques comme la perte ou la divulgation de données sensibles et les attaques par injection de prompt. Vous pouvez désactiver cette option. ",
    "learnMore": "En savoir plus",
    "ordinaryRiskAfterLink": "",
    "goBack": "Annuler",
    "turnOnButton": "Confirmer"
  },
  "en": {
    "warningTitle": "Turn on Full Access?",
    "warningDescription.codeMode": "Codex will be able to run commands, use the internet, and create and edit files anywhere on this computer without your permission. This includes but is not limited to:",
    "files.title": "Files and folders",
    "files.description": "Read, create, modify, upload, or delete files anywhere on this computer",
    "terminal.title": "Terminal commands",
    "terminal.description": "Run commands, install software, and change system settings",
    "internet.title": "Internet and connected apps",
    "internet.description": "Access websites, send data, and use enabled plugins",
    "ordinaryRiskBeforeLink": "This comes with risks like loss or exposure of sensitive data and prompt injection. You can turn this off. ",
    "learnMore": "Learn more",
    "ordinaryRiskAfterLink": "",
    "goBack": "Cancel",
    "turnOnButton": "Confirm"
  }
} as const;

type Capability = "files" | "terminal" | "internet";

function WarningTriangle({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8.505 3.645c.657-1.147 2.333-1.147 2.99 0l6.025 10.526c.64 1.119-.176 2.504-1.495 2.504H3.975c-1.319 0-2.135-1.385-1.495-2.504L8.505 3.645Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M10 7.083v3.334" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M10 13.333h.008" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CapabilityIcon({ kind }: { kind: Capability }) {
  return (
    <svg aria-hidden="true" className="full-access-capability-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {kind === "files" ? (
        <>
          <path fill="#2E9EFF" d="M22 9v4H2V7c0-2.35 1.65-4 4-4h2.637c2.988 0 2.75 2 4.613 2H18c2.35 0 4 1.65 4 4Z" />
          <path fill="#68C4FF" d="M18 21c2.35 0 4-1.65 4-4v-5a3 3 0 0 0-3-3H5a3 3 0 0 0-3 3v5c0 2.35 1.65 4 4 4h12Z" />
        </>
      ) : kind === "terminal" ? (
        <>
          <path fill="var(--full-access-terminal-background)" d="M7 21c-.775 0-1.467-.167-2.075-.5A3.66 3.66 0 0 1 3.5 19.075c-.333-.608-.5-1.3-.5-2.075V7c0-.775.167-1.467.5-2.075a3.575 3.575 0 0 1 1.425-1.412C5.533 3.17 6.225 3 7 3h10c.775 0 1.467.17 2.075.513.608.333 1.08.804 1.413 1.412.341.608.512 1.3.512 2.075v10c0 .775-.17 1.467-.512 2.075a3.576 3.576 0 0 1-1.413 1.425c-.608.333-1.3.5-2.075.5H7Z" />
          <path fill="#fff" d="M11 12a.995.995 0 0 1-.313.725l-1.962 1.963A.968.968 0 0 1 8 15a.955.955 0 0 1-.712-.313.955.955 0 0 1-.313-.712c0-.275.104-.512.313-.713L8.538 12l-1.25-1.25a.955.955 0 0 1-.313-.713c0-.283.104-.529.313-.737.2-.2.437-.3.712-.3.283 0 .525.1.725.3l1.963 1.975c.1.1.175.217.224.35A.88.88 0 0 1 11 12Zm5.7 2.713A.953.953 0 0 1 16 15h-3a.995.995 0 0 1-.713-.287A.995.995 0 0 1 12 14c0-.275.096-.508.287-.7.2-.2.438-.3.713-.3h3c.275 0 .508.1.7.3.2.192.3.425.3.7 0 .275-.1.512-.3.713Z" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="9" fill="var(--full-access-internet-background)" />
          <path fill="var(--full-access-internet-foreground)" fillRule="evenodd" d="M12 2c5.522 0 10 4.478 10 10s-4.478 10-10 10S2 17.522 2 12 6.478 2 12 2ZM9.172 13c.146 4.477 1.284 7 2.828 7 1.544 0 2.682-2.523 2.828-7H9.172Zm-5.108 0a7.994 7.994 0 0 0 4.313 6.134C7.686 17.622 7.261 15.549 7.174 13h-3.11Zm12.762 0c-.087 2.55-.512 4.622-1.204 6.134A7.994 7.994 0 0 0 19.936 13h-3.11Zm-8.45-8.135A7.995 7.995 0 0 0 4.065 11h3.11c.087-2.55.511-4.623 1.203-6.135ZM12.001 4c-1.544 0-2.682 2.523-2.828 7h5.656C14.682 6.523 13.544 4 12 4Zm3.622.865C16.314 6.377 16.74 8.45 16.826 11h3.11a7.995 7.995 0 0 0-4.314-6.135Z" clipRule="evenodd" />
        </>
      )}
    </svg>
  );
}

interface NativeFullAccessConfirmationProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function NativeFullAccessConfirmation({
  open,
  onConfirm,
  onCancel,
}: NativeFullAccessConfirmationProps) {
  const { i18n } = useTranslation("composer");
  // Some existing isolated callers mock only t; keep their defined zh fallback.
  const language = i18n?.resolvedLanguage ?? i18n?.language ?? "zh";
  const text = language.startsWith("zh")
    ? messages.zh
    : language.startsWith("ja")
      ? messages.ja
      : language.startsWith("fr")
        ? messages.fr
        : messages.en;
  const capabilities: { kind: Capability; title: string; description: string }[] = [
    { kind: "files", title: text["files.title"], description: text["files.description"] },
    { kind: "terminal", title: text["terminal.title"], description: text["terminal.description"] },
    { kind: "internet", title: text["internet.title"], description: text["internet.description"] },
  ];
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent showCloseButton={false} overlayClassName="session-native-full-access-overlay" className="session-native-full-access-confirmation">
        <form className="full-access-form" onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onConfirm();
        }}>
          <div className="full-access-section">
            <DialogTitle className="full-access-title">
              <WarningTriangle className="full-access-title-icon" />
              {text.warningTitle}
            </DialogTitle>
          </div>
          <div className="full-access-section">
            <DialogDescription className="full-access-description">
              {text["warningDescription.codeMode"]}
            </DialogDescription>
          </div>
          <div className="full-access-section">
            <div className="full-access-capabilities">
              {capabilities.map((capability) => (
                <div key={capability.kind} className="full-access-capability">
                  <CapabilityIcon kind={capability.kind} />
                  <div className="full-access-capability-copy">
                    <div className="full-access-capability-title">{capability.title}</div>
                    <div className="full-access-capability-description">{capability.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="full-access-section">
            <p className="full-access-risk">
              {text.ordinaryRiskBeforeLink}
              <button type="button" className="full-access-learn-more" onClick={() => { void openUrl(FULL_ACCESS_DOCUMENTATION); }}>
                {text.learnMore}
              </button>
              {text.ordinaryRiskAfterLink}
            </p>
          </div>
          <div className="full-access-section">
            <div className="full-access-footer">
              <button type="button" className="full-access-cancel" onClick={onCancel}>
                {text.goBack}
              </button>
              <button type="submit" className="full-access-confirm">
                <WarningTriangle className="full-access-confirm-icon" />
                {text.turnOnButton}
              </button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Local resolver semantics match useSessionActionConfirmation; no permission setter lives here. */
export function useNativeFullAccessConfirmation() {
  const [open, setOpen] = useState(false);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const finish = useCallback((value: boolean) => {
    const pending = resolver.current;
    resolver.current = null;
    setOpen(false);
    pending?.(value);
  }, []);
  const ask = useCallback(() => {
    resolver.current?.(false);
    setOpen(true);
    return new Promise<boolean>((resolve) => { resolver.current = resolve; });
  }, []);
  useEffect(() => () => {
    resolver.current?.(false);
    resolver.current = null;
  }, []);
  return {
    ask,
    open,
    confirmation: <NativeFullAccessConfirmation open={open} onConfirm={() => finish(true)} onCancel={() => finish(false)} />,
  };
}
