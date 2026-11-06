import { useEffect, useState } from 'react';

function narrowViewport() {
  if (typeof window === 'undefined') return false;
  try {
    if (typeof window.matchMedia === 'function')
      return window.matchMedia('(max-width: 760px)').matches;
  } catch {
    // Use the viewport fallback below when media queries are unavailable.
  }
  return window.innerWidth <= 760;
}

export function useNarrowViewport() {
  const [narrow, setNarrow] = useState(narrowViewport);
  useEffect(() => {
    let query: MediaQueryList | undefined;
    try {
      query = window.matchMedia?.('(max-width: 760px)');
    } catch {
      query = undefined;
    }
    if (
      query &&
      typeof query.addEventListener === 'function' &&
      typeof query.removeEventListener === 'function'
    ) {
      const change = (event: MediaQueryListEvent) => setNarrow(event.matches);
      setNarrow(query.matches);
      query.addEventListener('change', change);
      return () => query?.removeEventListener('change', change);
    }
    const resize = () => setNarrow(window.innerWidth <= 760);
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  return narrow;
}
