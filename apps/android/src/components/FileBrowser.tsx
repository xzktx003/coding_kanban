import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { AgentSessionRecord } from "@agent-orchestrator/shared";
import {
  buildFilePreviewUrl,
  entryIsDirectory,
  listFiles,
  previewFile,
  type FileEntry,
  type FilePreviewResponse,
} from "../api/filesApi";
import { buildUrl } from "../core/transport";
import { colors, radius, spacing, typography } from "../theme";

function fileIcon(entry: FileEntry): string {
  if (entry.type === "directory") return "▸";
  return "·";
}

export function FileBrowser({
  session,
  onBack,
}: {
  session: AgentSessionRecord;
  onBack: () => void;
  backLabel?: string;
}) {
  const [path, setPath] = useState<string>(
    session.workingDirectory ?? session.repositoryRoot ?? "/",
  );
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<FilePreviewResponse | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const sshTarget = session.sshTarget ?? undefined;

  const load = useCallback(
    async (targetPath: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await listFiles({ path: targetPath, sshTarget, showHidden: false });
        setEntries(res.entries ?? []);
        setPath(res.path ?? targetPath);
      } catch (e) {
        setError(e instanceof Error ? e.message : "LIST_FAILED");
      } finally {
        setLoading(false);
      }
    },
    [sshTarget],
  );

  useEffect(() => {
    void load(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openPreview = useCallback(
    async (entry: FileEntry) => {
      if (entry.type === "directory") {
        void load(entry.path);
        return;
      }
      const mime = entry.name.toLowerCase().match(/\.(png|jpe?g|gif|webp)$/)?.[0];
      if (mime) {
        setImageUrl(buildUrl(buildFilePreviewUrl(entry.path, sshTarget)));
        return;
      }
      try {
        const res = await previewFile({ path: entry.path, sshTarget });
        setPreview(res);
      } catch (e) {
        setError(e instanceof Error ? e.message : "PREVIEW_FAILED");
      }
    },
    [load, sshTarget],
  );

  const parentPath = useMemo(() => {
    const trimmed = path.replace(/\/+$/, "");
    const idx = trimmed.lastIndexOf("/");
    if (idx <= 0) return "/";
    return trimmed.slice(0, idx);
  }, [path]);

  const rows = useMemo(
    () => [...entries].sort((a, b) => (a.type === "directory" ? -1 : 1) - (b.type === "directory" ? -1 : 1) || a.name.localeCompare(b.name)),
    [entries],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onBack}>
          <Text style={styles.back}>‹ 返回</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {session.projectName ?? "文件"}
        </Text>
      </View>

      <View style={styles.pathRow}>
        <Pressable onPress={() => void load(parentPath)}>
          <Text style={styles.up}>↑ 上一级</Text>
        </Pressable>
        <Text style={styles.path} numberOfLines={1}>
          {path}
        </Text>
      </View>

      {loading ? (
        <Text style={styles.empty}>正在加载…</Text>
      ) : error ? (
        <Text style={styles.empty}>{error}</Text>
      ) : rows.length === 0 ? (
        <Text style={styles.empty}>空目录</Text>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.path}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => void openPreview(item)}>
              <Text style={styles.icon}>{fileIcon(item)}</Text>
              <Text style={styles.name} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.size}>
                {entryIsDirectory(item) ? "" : formatSize(item.size)}
              </Text>
            </Pressable>
          )}
        />
      )}

      {/* Text/markdown preview */}
      <Modal
        visible={Boolean(preview)}
        transparent
        animationType="slide"
        onRequestClose={() => setPreview(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} numberOfLines={1}>
                {preview?.path}
              </Text>
              <Pressable onPress={() => setPreview(null)}>
                <Text style={styles.close}>✕</Text>
              </Pressable>
            </View>
            <Text style={styles.modalContent} selectable>
              {preview?.content ?? ""}
            </Text>
          </View>
        </View>
      </Modal>

      {/* Image preview */}
      <Modal
        visible={Boolean(imageUrl)}
        transparent
        animationType="fade"
        onRequestClose={() => setImageUrl(null)}
      >
        <View style={styles.imageBackdrop}>
          <Pressable style={styles.imageClose} onPress={() => setImageUrl(null)}>
            <Text style={styles.close}>✕</Text>
          </Pressable>
          {imageUrl && (
            <Image source={{ uri: imageUrl }} style={styles.image} resizeMode="contain" />
          )}
        </View>
      </Modal>
    </View>
  );
}

function formatSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / 1024 / 1024).toFixed(1)}M`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back: { color: colors.accent, fontWeight: "600", marginRight: spacing.md },
  title: { ...typography.h3, flex: 1 },
  pathRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bgElevated,
  },
  up: { color: colors.accent, fontWeight: "600", marginRight: spacing.md },
  path: { flex: 1, ...typography.caption, color: colors.textSecondary },
  empty: { ...typography.bodySecondary, color: colors.textMuted, textAlign: "center", padding: spacing.xl },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  icon: { width: 24, color: colors.textMuted },
  name: { flex: 1, ...typography.body },
  size: { ...typography.caption, color: colors.textMuted },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.overlay },
  modalCard: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: "80%",
    padding: spacing.lg,
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: spacing.sm },
  modalTitle: { ...typography.h3, flex: 1, marginRight: spacing.md },
  close: { color: colors.textSecondary, fontSize: 18 },
  modalContent: { ...typography.body, maxHeight: 420 },
  imageBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.85)", justifyContent: "center" },
  imageClose: { position: "absolute", top: spacing.xl, right: spacing.lg, zIndex: 2 },
  image: { width: "100%", height: "80%" },
});
