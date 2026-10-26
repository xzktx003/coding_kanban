import { Toaster as SonnerToaster } from "sonner"
import { useThemeContext } from "@session/contexts/ThemeContext"

export function Toaster() {
  const { resolvedTheme } = useThemeContext()
  return (
    <SonnerToaster
      theme={resolvedTheme}
      richColors
      closeButton
      position="top-right"
      // Offset from the edge so the close button (which overhangs the toast
      // by ~35% via transform) is not clipped by the viewport boundary.
      offset={20}
      toastOptions={{
        classNames: {
          // Ensure the close button is never hidden by overflow clipping.
          toast: "overflow-visible!",
        },
      }}
    />
  )
}
