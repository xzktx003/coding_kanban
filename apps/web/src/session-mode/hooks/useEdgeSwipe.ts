import { useEffect, useRef } from 'react';

type UseEdgeSwipeOptions = {
  /** px from left edge that counts as the swipe start zone */
  edgeThreshold?: number;
  /** minimum horizontal distance to trigger */
  minSwipeDistance?: number;
  onSwipeRight: () => void;
  enabled?: boolean;
};

/**
 * Detects a right-swipe starting from the left edge of the target element.
 * Attaches to `document` when no ref is provided.
 */
export function useEdgeSwipe({
  edgeThreshold = 30,
  minSwipeDistance = 60,
  onSwipeRight,
  enabled = true,
}: UseEdgeSwipeOptions) {
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch.clientX <= edgeThreshold) {
        startX.current = touch.clientX;
        startY.current = touch.clientY;
      } else {
        startX.current = null;
        startY.current = null;
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (startX.current === null || startY.current === null) return;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - startX.current;
      const dy = Math.abs(touch.clientY - startY.current);
      // Must be more horizontal than vertical to avoid conflicting with scroll
      if (dx >= minSwipeDistance && dx > dy) {
        onSwipeRight();
      }
      startX.current = null;
      startY.current = null;
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [edgeThreshold, minSwipeDistance, onSwipeRight, enabled]);
}
