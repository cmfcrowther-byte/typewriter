import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';

const Typewriter = forwardRef(function Typewriter({ onReady }, ref) {
  const containerRef = useRef(null);
  const onReadyRef = useRef(onReady);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  onReadyRef.current = onReady;

  useImperativeHandle(ref, () => containerRef.current, []);

  useEffect(() => {
    let cancelled = false;

    fetch(`${import.meta.env.BASE_URL}Typewriter2.svg`)
      .then((res) => res.text())
      .then((svgText) => {
        if (cancelled) return;
        const container = containerRef.current;
        if (!container) return;

        // Parse as SVG XML so malformed HTML injection cannot silently yield an empty container.
        const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
        if (parsed.querySelector('parsererror')) {
          throw new Error('Typewriter2.svg is not valid SVG XML');
        }

        const parsedRoot = parsed.documentElement;
        const rootName = parsedRoot?.nodeName?.toLowerCase() || '';
        const rootLocal = parsedRoot?.localName?.toLowerCase() || '';
        const isSvgRoot = rootLocal === 'svg' || rootName === 'svg' || rootName.endsWith(':svg');
        if (!parsedRoot || !isSvgRoot) {
          throw new Error('Typewriter2.svg did not parse to a root <svg> element');
        }

        const svg = document.importNode(parsedRoot, true);
        container.replaceChildren(svg);
        // Allow init/onReady to run again after SVG swap (e.g. React StrictMode remount, hot reload).
        delete container.dataset.typewriterInited;

        svg.removeAttribute('width');
        svg.removeAttribute('height');
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.style.width = '100%';
        svg.style.height = '100%';
        svg.style.overflow = 'visible';

        setLoading(false);
        setLoadError('');
        onReadyRef.current?.(container);
      })
      .catch((err) => {
        console.error('Failed to load typewriter SVG:', err);
        if (!cancelled) {
          setLoadError(err?.message || 'Failed to load SVG');
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, []);

  return (
    <div className="relative w-full h-full">
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ minHeight: 0 }}
      />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
          <span className="text-zinc-500 text-sm tracking-widest uppercase">
            Loading typewriter…
          </span>
        </div>
      )}
      {!loading && loadError && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-900 p-4">
          <span className="text-red-400 text-xs tracking-wide text-center">
            {loadError}
          </span>
        </div>
      )}
    </div>
  );
});

export default Typewriter;
