import { useState, useEffect } from 'react';

/**
 * Provides a responsive scale factor for typography/layout based on the size of a container.
 * The hook observes the element referenced by `ref` and returns a scale value that can be
 * multiplied against base font sizes to make content grow/shrink with the widget.
 */
const useResponsiveFontScale = (ref, {
  baseWidth = 320,
  baseHeight = 200,
  min = 0.6,
  max = 3
} = {}) => {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    const updateScale = (width, height) => {
      if (!width || !height) return;
      const widthScale = width / baseWidth;
      const heightScale = height / baseHeight;
      const nextScale = Math.min(widthScale, heightScale);
      setScale(prev => {
        const clamped = Math.min(max, Math.max(min, nextScale));
        // Avoid unnecessary renders for tiny differences
        if (Math.abs(clamped - prev) < 0.01) {
          return prev;
        }
        return clamped;
      });
    };

    const observer = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        const { width, height } = entry.contentRect;
        updateScale(width, height);
      });
    });

    observer.observe(element);

    // Initialise immediately with current size
    const rect = element.getBoundingClientRect();
    updateScale(rect.width, rect.height);

    return () => observer.disconnect();
  }, [ref, baseWidth, baseHeight, min, max]);

  return scale;
};

export default useResponsiveFontScale;
