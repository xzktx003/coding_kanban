import { Streamdown } from "streamdown";
import { createMathPlugin } from "@streamdown/math";
import { codexCode as code } from "./codexCode";
import { nativeMermaid as mermaid } from "./nativeMermaidLayout";
import { nativeMermaidConfig } from "./nativeMermaidTheme";
import { useThemeContext } from "@session/contexts/ThemeContext";
import { useMemo } from "react";

const math = createMathPlugin({ singleDollarTextMath: true });

export default function NativeMermaidFence({
  source,
  streaming,
}: {
  source: string;
  streaming: boolean;
}) {
  const { resolvedTheme } = useThemeContext();
  const config = useMemo(
    () => nativeMermaidConfig(resolvedTheme, source),
    [resolvedTheme, source],
  );
  return (
    <Streamdown
      plugins={{ code, math, mermaid }}
      mermaid={{ config }}
      controls={{
        mermaid: {
          copy: true,
          download: true,
          fullscreen: false,
          panZoom: true,
        },
      }}
      mode={streaming ? "streaming" : "static"}
      isAnimating={streaming}
    >{`\`\`\`mermaid\n${source}\n\`\`\``}</Streamdown>
  );
}
