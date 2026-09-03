import { Link } from '@tanstack/react-router';
import {
  Cloud,
  Download,
  Home,
  type LucideIcon,
  Menu,
  Monitor,
  Moon,
  Network,
  Radar,
  Search,
  Settings as SettingsIcon,
  Sun,
  X,
} from 'lucide-react';
import { useRef } from 'react';

import type { DestinationDefinition, DestinationId } from '../app/feature-registry';
import { ProtoPeekMark } from '../ProtoPeekMark';
import { useDialogFocus } from '../use-dialog-focus';

const destinationIcons: Record<DestinationDefinition['icon'], LucideIcon> = {
  home: Home,
  search: Search,
  network: Network,
  cloud: Cloud,
  download: Download,
  settings: SettingsIcon,
};

export type AppBarProps = {
  destinations: readonly DestinationDefinition[];
  activeDestinationId?: DestinationId;
  activeLabel: string;
  modifier: string;
  resolvedTheme: 'light' | 'dark';
  navigationOpen: boolean;
  onOpenNavigation: () => void;
  onCloseNavigation: () => void;
  onInspect: () => void;
  onOpenCommand: () => void;
  onToggleTheme: () => void;
};

export function AppBar(props: AppBarProps) {
  return (
    <>
      <header className="pp-app-bar">
        <button
          type="button"
          className="pp-app-bar-menu"
          aria-label="Open navigation menu"
          aria-controls="protopeek-mobile-navigation"
          aria-expanded={props.navigationOpen}
          onClick={props.onOpenNavigation}
        >
          <Menu aria-hidden="true" />
        </button>
        <Link
          to="/"
          className="pp-app-brand"
          aria-label="Open ProtoPeek Home"
          activeOptions={{ exact: true }}
        >
          <ProtoPeekMark />
          <strong>ProtoPeek</strong>
        </Link>
        <span className="pp-app-current">{props.activeLabel}</span>

        <nav className="pp-app-navigation" aria-label="Destinations">
          {props.destinations.map((item) => {
            const Icon = destinationIcons[item.icon];
            const active = item.id === props.activeDestinationId;
            return (
              <Link
                key={item.id}
                to={item.route}
                className={`pp-app-navigation-link${active ? ' is-active' : ''}`}
                activeOptions={{ exact: true }}
                aria-current={active ? 'page' : undefined}
                aria-label={`Open ${item.label}`}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="pp-app-actions">
          <button type="button" className="pp-app-inspect" onClick={props.onInspect}>
            <Radar aria-hidden="true" /> <span>Inspect target</span>
          </button>
          <button
            type="button"
            className="pp-app-command"
            aria-label="Open global command menu"
            onClick={props.onOpenCommand}
          >
            <Search aria-hidden="true" />
            <span>Search or run a command</span>
            <kbd>{props.modifier} K</kbd>
          </button>
          <button
            type="button"
            className="pp-app-icon-action pp-app-theme"
            aria-label={`Use ${props.resolvedTheme === 'light' ? 'dark' : 'light'} mode`}
            onClick={props.onToggleTheme}
          >
            {props.resolvedTheme === 'light' ? (
              <Moon aria-hidden="true" />
            ) : (
              <Sun aria-hidden="true" />
            )}
          </button>
        </div>
      </header>

      <MobileNavigationDrawer {...props} />
    </>
  );
}

function MobileNavigationDrawer({
  destinations,
  activeDestinationId,
  navigationOpen,
  onCloseNavigation,
  onInspect,
}: AppBarProps) {
  const drawerRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  useDialogFocus(navigationOpen, onCloseNavigation, drawerRef, closeButtonRef);

  if (!navigationOpen) return null;

  function closeThen(action: () => void) {
    onCloseNavigation();
    action();
  }

  return (
    <div className="pp-navigation-layer">
      <button
        type="button"
        className="pp-navigation-backdrop"
        aria-label="Close navigation menu"
        onClick={onCloseNavigation}
      />
      <aside
        id="protopeek-mobile-navigation"
        ref={drawerRef}
        className="pp-navigation-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="protopeek-mobile-navigation-title"
      >
        <header>
          <div>
            <ProtoPeekMark />
            <span>
              <strong id="protopeek-mobile-navigation-title">ProtoPeek</strong>
              <small>Local service workbench</small>
            </span>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="pp-navigation-close"
            aria-label="Close navigation menu"
            onClick={onCloseNavigation}
          >
            <X aria-hidden="true" />
          </button>
        </header>
        <nav aria-label="Mobile destinations">
          {destinations.map((item) => {
            const Icon = destinationIcons[item.icon];
            const active = item.id === activeDestinationId;
            return (
              <Link
                key={item.id}
                to={item.route}
                className={`pp-navigation-link${active ? ' is-active' : ''}`}
                activeOptions={{ exact: true }}
                aria-current={active ? 'page' : undefined}
                onClick={onCloseNavigation}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="pp-navigation-actions">
          <button type="button" className="pp-navigation-link" onClick={() => closeThen(onInspect)}>
            <Radar aria-hidden="true" /> Inspect target
          </button>
        </div>
        <footer>
          <Monitor aria-hidden="true" /> Local app · no account or cloud sync
        </footer>
      </aside>
    </div>
  );
}
