export type FileAction =
  | "new-file"
  | "new-folder"
  | "rename"
  | "move"
  | "delete"
  | "download"
  | "copy-path"
  | "copy-relative"
  | "upload";
export type FileNode = {
  name: string;
  path: string;
  kind: "file" | "dir" | "symlink";
  children?: FileNode[];
};

export type FileTreeProps = {
  folder: string;
  onFileSelect?: (path: string) => void;
  onFileAction?: (action: FileAction, node: FileNode) => void;
};
