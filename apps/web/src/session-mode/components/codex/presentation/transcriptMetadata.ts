export type TranscriptMetadata = { transcriptMetadataOnly?: boolean };

/** The chat projection deliberately omitted the original tool body. */
export function isTranscriptMetadataOnly(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as TranscriptMetadata).transcriptMetadataOnly === true
  );
}
