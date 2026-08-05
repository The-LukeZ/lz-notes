// Markdown is the stored source of truth (raw LLM output), so exporting it is a
// trivial passthrough — just encode the string to bytes (PLAN §8). The result is
// wrapped in a fresh Uint8Array so it is concretely ArrayBuffer-backed (a
// BlobPart / BodyInit), not the generic Uint8Array<ArrayBufferLike>.

export function exportMarkdown(markdown: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(markdown));
}
