/** Compare the disk before saving shared project files. */
export async function saveFileWithConflictCheck(
  path: string,
  original: string,
  draft: string,
  read: (path: string) => Promise<string>,
  write: (path: string, content: string) => Promise<unknown>,
  confirm: (message: string) => boolean = window.confirm,
): Promise<void> {
  const disk = await read(path);
  if (
    disk !== original &&
    disk !== draft &&
    !confirm("文件已被其他会话或程序修改。确认用当前草稿覆盖磁盘内容？")
  )
    throw new Error("未覆盖磁盘内容，草稿已保留");
  await write(path, draft);
}
