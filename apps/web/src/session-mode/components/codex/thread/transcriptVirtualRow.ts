type VirtualRowIdentity = {
  index: number;
  key: string | number | bigint;
};

/** Resolve a virtual item only when its index and identity still match rows. */
export function transcriptRowForVirtualItem<Row extends { key: string }>(
  rows: readonly Row[],
  item: VirtualRowIdentity,
): Row | undefined {
  const row = rows[item.index];
  return row?.key === item.key ? row : undefined;
}
