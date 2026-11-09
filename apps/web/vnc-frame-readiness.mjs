// Acceptance requires pixels delivered by RFB. A connected socket and a sized
// blank canvas establish authentication only, and must not count as a frame.
// This function is also serializable into the isolated test browser; it retains
// no pixels, text, URLs or credentials in its result.
export function inspectNativeCanvas(canvas) {
  const width = canvas?.width,
    height = canvas?.height;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 32 ||
    height < 32 ||
    width > 4096 ||
    height > 4096
  )
    return { state: "invalid" };
  try {
    const data = canvas.getContext("2d").getImageData(0, 0, width, height).data;
    if (!data || data.length !== width * height * 4)
      return { state: "unreadable", width, height };
    const step = Math.max(1, Math.ceil((width * height) / 16384)),
      colors = new Set();
    let sampled = 0,
      opaque = 0;
    for (let pixel = 0; pixel < width * height; pixel += step) {
      const i = pixel * 4;
      sampled++;
      if (data[i + 3] !== 255) continue;
      opaque++;
      if (colors.size < 64)
        colors.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    }
    return {
      state: opaque >= 16 && colors.size >= 4 ? "ready" : "waiting",
      width,
      height,
      sampled,
      opaque,
      colors: colors.size,
    };
  } catch {
    return { state: "unreadable", width, height };
  }
}
