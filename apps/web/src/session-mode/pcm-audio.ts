export function encodePcm16k(chunks: Float32Array[], inputRate: number): Uint8Array {
  if (!Number.isFinite(inputRate) || inputRate < 8000 || inputRate > 192000) throw new Error("Invalid capture rate");
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (length / inputRate > 120) throw new Error("录音最长为 120 秒");
  const input = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) { input.set(chunk, offset); offset += chunk.length; }
  const count = Math.floor(length * 16000 / inputRate);
  const output = new Uint8Array(count * 2);
  const view = new DataView(output.buffer);
  for (let index = 0; index < count; index++) {
    const position = index * inputRate / 16000;
    const left = Math.floor(position);
    const fraction = position - left;
    const value = Math.max(-1, Math.min(1, input[left] * (1 - fraction) + (input[Math.min(left + 1, length - 1)] ?? 0) * fraction));
    view.setInt16(index * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return output;
}
