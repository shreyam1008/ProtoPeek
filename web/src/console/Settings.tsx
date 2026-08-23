import { Eye, Keyboard, LayoutPanelLeft, LockKeyhole, Monitor, RotateCcw } from 'lucide-react';
import { useState } from 'react';

import type { ProtoPeekTheme } from '@/shared/theme';

import { defaultInterfacePreferences, type InterfaceDensity } from './interface-preferences';
import { useProtocolShell } from './ProtocolShellContext';
import './suite-pages.css';

const themes: Array<{ value: ProtoPeekTheme; label: string; detail: string }> = [
  { value: 'light', label: 'Light', detail: 'Bright evidence surfaces and dark text.' },
  { value: 'dark', label: 'Dark', detail: 'Low-glare console surfaces and teal signals.' },
];

const densities: Array<{ value: InterfaceDensity; label: string; detail: string }> = [
  { value: 'comfortable', label: 'Comfortable', detail: 'More breathing room in app chrome.' },
  { value: 'compact', label: 'Compact', detail: 'Tighter navigation and header controls.' },
];

export function Settings() {
  const { theme, setTheme, interfacePreferences, setInterfacePreferences } = useProtocolShell();
  const [notice, setNotice] = useState('');

  function setDensity(density: InterfaceDensity) {
    setNotice('');
    setInterfacePreferences({ ...interfacePreferences, density });
  }

  function setKeyboardHints(showKeyboardHints: boolean) {
    setNotice('');
    setInterfacePreferences({ ...interfacePreferences, showKeyboardHints });
  }

  function restoreDefaults() {
    setTheme('light');
    setInterfacePreferences(defaultInterfacePreferences);
    setNotice('Interface defaults restored.');
  }

  return (
    <div className="pp-suite-page pp-settings-page">
      <header className="pp-suite-page-heading">
        <div>
          <span className="pp-kicker">Settings</span>
          <h1>Shape this browser&apos;s console.</h1>
          <p>
            Only interface preferences live here. Host, network, and protocol limits stay with their
            real capability surfaces.
          </p>
        </div>
        <span className="pp-settings-local">
          <LockKeyhole aria-hidden="true" /> Browser-local
        </span>
      </header>

      {notice ? (
        <p className="pp-settings-notice" role="status">
          {notice}
        </p>
      ) : null}

      <div className="pp-settings-layout">
        <section className="pp-settings-panel" aria-labelledby="appearance-title">
          <header>
            <Monitor aria-hidden="true" />
            <div>
              <h2 id="appearance-title">Appearance</h2>
              <p>Applied immediately and saved in this browser profile.</p>
            </div>
          </header>

          <fieldset className="pp-settings-choice-group">
            <legend>Theme</legend>
            {themes.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={theme === option.value}
                onClick={() => {
                  setNotice('');
                  setTheme(option.value);
                }}
              >
                <span>{option.label}</span>
                <small>{option.detail}</small>
              </button>
            ))}
          </fieldset>

          <fieldset className="pp-settings-choice-group">
            <legend>Interface density</legend>
            {densities.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={interfacePreferences.density === option.value}
                onClick={() => setDensity(option.value)}
              >
                <span>{option.label}</span>
                <small>{option.detail}</small>
              </button>
            ))}
          </fieldset>
        </section>

        <section className="pp-settings-panel" aria-labelledby="local-preferences-title">
          <header>
            <LayoutPanelLeft aria-hidden="true" />
            <div>
              <h2 id="local-preferences-title">Local preferences</h2>
              <p>Presentation choices only; these do not alter the ProtoPeek host.</p>
            </div>
          </header>

          <label className="pp-settings-toggle">
            <Keyboard aria-hidden="true" />
            <span>
              <strong>Show keyboard shortcut hints</strong>
              <small>Display key labels beside command and workbench actions.</small>
            </span>
            <input
              type="checkbox"
              checked={interfacePreferences.showKeyboardHints}
              onChange={(event) => setKeyboardHints(event.target.checked)}
            />
          </label>

          <div className="pp-settings-boundary">
            <Eye aria-hidden="true" />
            <div>
              <strong>What this page does not control</strong>
              <p>
                CPU, memory, scan authorization, TLS verification, destinations, and protocol
                deadlines remain explicit where they are used. This page never pretends to change
                host policy.
              </p>
            </div>
          </div>

          <button type="button" className="pp-settings-reset" onClick={restoreDefaults}>
            <RotateCcw aria-hidden="true" /> Restore interface defaults
          </button>
        </section>
      </div>
    </div>
  );
}
