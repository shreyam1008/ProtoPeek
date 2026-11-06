import { useLocation } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { type FeatureId, featureForPath, featureRegistry } from './app/feature-registry';
import { toolHelp } from './tool-help';
import { useDialogFocus } from './use-dialog-focus';
import './help-drawer.css';

export function HelpDrawer({ onClose }: { onClose: () => void }) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const current = featureForPath(pathname)?.id ?? 'overview';
  const [topic, setTopic] = useState<FeatureId>(current);
  const drawerRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  useDialogFocus(true, onClose, drawerRef, closeButtonRef);
  useEffect(() => setTopic(current), [current]);
  const feature = featureRegistry.find((entry) => entry.id === topic);
  const guide = toolHelp[topic];

  return (
    <div className="pp-help-layer">
      <button
        type="button"
        className="pp-help-backdrop"
        aria-label="Close help"
        onClick={onClose}
      />
      <aside
        ref={drawerRef}
        className="pp-help-drawer pp-help-guide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="protopeek-help-title"
      >
        <header>
          <div>
            <span>ProtoPeek guide</span>
            <h2 id="protopeek-help-title">Help for this tool</h2>
          </div>
          <button ref={closeButtonRef} type="button" aria-label="Close help" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <p className="pp-help-intro">
          A quick guide to the task and its limits. Opening help starts nothing.
        </p>
        <label className="pp-help-topic">
          <span>Help topic</span>
          <select
            value={topic}
            onChange={(event) => setTopic(event.currentTarget.value as FeatureId)}
          >
            {featureRegistry.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <section aria-labelledby="pp-help-task-title">
          <h3 id="pp-help-task-title">{feature?.label ?? 'Home'}</h3>
          <ol>
            {guide.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>
        <section aria-labelledby="pp-help-boundary-title">
          <h3 id="pp-help-boundary-title">What to know</h3>
          <p>{guide.boundary}</p>
        </section>
      </aside>
    </div>
  );
}
