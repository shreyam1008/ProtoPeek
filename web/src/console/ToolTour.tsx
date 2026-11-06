import { useLocation } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { type FeatureId, featureForPath, featureRegistry } from './app/feature-registry';
import { useDownloadMode } from './download-mode';
import { mediaDownloadHelp, toolHelp } from './tool-help';
import { mediaTourHints, mediaTourTargets, tourHints, tourTargets } from './tour-targets';
import './tool-tour.css';

export function ToolTour({ feature, onClose }: { feature: FeatureId; onClose: () => void }) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const [index, setIndex] = useState(0);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [dock, setDock] = useState<'top' | 'bottom' | null>(null);
  const [attempt, setAttempt] = useState(0);
  const downloadMode = useDownloadMode();
  const panel = useRef<HTMLElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const isMedia = feature === 'downloader' && downloadMode === 'media';
  const guide = isMedia ? mediaDownloadHelp : toolHelp[feature];
  const name = isMedia
    ? 'Media downloader'
    : (featureRegistry.find((entry) => entry.id === feature)?.label ?? 'this tool');

  // biome-ignore lint/correctness/useExhaustiveDependencies: A mode change starts the corresponding guide at its first step.
  useEffect(() => setIndex(0), [isMedia]);

  useEffect(() => {
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();
    return () => previousFocus.current?.focus();
  }, []);

  useEffect(() => {
    if (featureForPath(pathname)?.id !== feature) onClose();
  }, [pathname, feature, onClose]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry rechecks the page after the user changes its state.
  useEffect(() => {
    const selector = isMedia ? mediaTourTargets[index] : tourTargets[feature][index];
    const canvas = document.getElementById('pp-workbench-canvas');
    if (!canvas || !selector) {
      setTarget(null);
      return;
    }

    let current: HTMLElement | null = null;
    let addedTabIndex = false;
    let frame = 0;
    function release() {
      current?.classList.remove('pp-tour-target');
      if (addedTabIndex) current?.removeAttribute('tabindex');
    }
    const locate = () => {
      frame = 0;
      const match =
        Array.from(canvas.querySelectorAll<HTMLElement>(selector)).find(
          (node) =>
            !node.matches(':disabled') &&
            !node.closest('[hidden], [inert], [aria-hidden="true"]') &&
            getComputedStyle(node).visibility !== 'hidden' &&
            node.getClientRects().length > 0
        ) ?? null;
      setTarget(match);
      if (match === current) return;
      release();
      current = match;
      addedTabIndex = !!match && match.tabIndex < 0 && !match.hasAttribute('tabindex');
      if (addedTabIndex) match?.setAttribute('tabindex', '-1');
      match?.classList.add('pp-tour-target');
    };
    function schedule() {
      if (!frame) frame = requestAnimationFrame(locate);
    }
    locate();
    const observer = new MutationObserver(schedule);
    observer.observe(canvas, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        'disabled',
        'hidden',
        'inert',
        'aria-hidden',
        'aria-pressed',
        'open',
        'class',
        'style',
      ],
    });
    window.addEventListener('resize', schedule);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
      release();
    };
  }, [feature, index, attempt, isMedia]);

  useEffect(() => {
    function revealFocusedTarget() {
      if (!target?.contains(document.activeElement) || !panel.current) return;
      const control = target.getBoundingClientRect();
      const guide = panel.current.getBoundingClientRect();
      if (
        control.top < guide.bottom &&
        control.bottom > guide.top &&
        control.left < guide.right &&
        control.right > guide.left
      ) {
        setDock(control.top + control.height / 2 < window.innerHeight / 2 ? 'bottom' : 'top');
      }
    }
    function closeFromTarget(event: KeyboardEvent) {
      if (event.key === 'Escape' && target?.contains(document.activeElement)) {
        event.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', closeFromTarget);
    document.addEventListener('focusin', revealFocusedTarget);
    return () => {
      document.removeEventListener('keydown', closeFromTarget);
      document.removeEventListener('focusin', revealFocusedTarget);
    };
  }, [target, onClose]);

  const step = guide.steps[index] ?? guide.steps[0];
  return (
    <section
      ref={panel}
      tabIndex={-1}
      className="pp-tool-tour"
      data-dock={dock ?? undefined}
      aria-label={`${name} guided steps`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {dock ? (
        <button
          type="button"
          onClick={() => {
            setDock(null);
            panel.current?.focus();
          }}
        >
          Show step {index + 1}
        </button>
      ) : null}
      <div hidden={!!dock}>
        <header>
          <div>
            <span>
              Guided steps · {index + 1} of {guide.steps.length}
            </span>
            <h2>{name}</h2>
          </div>
          <button type="button" aria-label="Close guided steps" onClick={onClose}>
            ×
          </button>
        </header>
        <p aria-live="polite">{step}</p>
        {index === 0 ? <p className="pp-tour-note">The guide never runs a tool for you.</p> : null}
        {target ? (
          <button
            type="button"
            className="pp-tour-show"
            onClick={() => {
              target.scrollIntoView({ block: 'center', inline: 'nearest' });
              target.focus({ preventScroll: true });
            }}
          >
            Go to highlighted area
          </button>
        ) : (
          <div>
            <p className="pp-tour-note">
              {(isMedia ? mediaTourHints[index] : tourHints[feature]?.[index]) ||
                'Wait for this view or complete the previous step.'}
            </p>
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>
              Find this step
            </button>
          </div>
        )}
        <p className="pp-tour-note">{guide.boundary}</p>
      </div>
      <div className="pp-tour-actions">
        <button
          type="button"
          disabled={index === 0}
          onClick={() => {
            setDock(null);
            setIndex(index - 1);
          }}
        >
          Back
        </button>
        {index + 1 < guide.steps.length ? (
          <button
            type="button"
            onClick={() => {
              setDock(null);
              setIndex(index + 1);
            }}
          >
            Next
          </button>
        ) : (
          <button type="button" onClick={onClose}>
            Done
          </button>
        )}
      </div>
    </section>
  );
}
