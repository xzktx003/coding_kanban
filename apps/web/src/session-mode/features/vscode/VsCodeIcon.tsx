import vscodeIcon from "@session/assets/app-icons/vscode.png";
export function VsCodeIcon({
  className,
  size = 18,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <img
      src={vscodeIcon}
      className={className}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
