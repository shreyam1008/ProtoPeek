import { Link } from '@tanstack/react-router';
import {
  CircleHelp,
  Cloud,
  Download,
  Home,
  ListTodo,
  type LucideIcon,
  Menu,
  Monitor,
  Moon,
  Network,
  Radar,
  Search,
  Server,
  Settings as SettingsIcon,
  ShieldCheck,
  Sun,
  X,
} from 'lucide-react';
import { useRef } from 'react';

import type { PrimaryNavigationFeature, SecondaryNavigationFeature } from '../app/feature-registry';
import { ProtoPeekMark } from '../ProtoPeekMark';
import { useDialogFocus } from '../use-dialog-focus';

const primaryIcons: Record<PrimaryNavigationFeature['id'], LucideIcon> = {
  overview: Home,
  protocols: Server,
  network: Network,
  'this-pc': Monitor,
  tunnels: Cloud,
  downloader: Download,
  security: ShieldCheck,
  settings: SettingsIcon,
};

const secondaryIcons: Record<SecondaryNavigationFeature['id'], LucideIcon> = {
  roadmap: ListTodo,
};

export type AppBarProps = {
  primaryNavigation: readonly PrimaryNavigationFeature[];
  secondaryNavigation: readonly SecondaryNavigationFeature[];
  activeLabel: string;
  modifier: string;
  resolvedTheme: 'light' | 'dark';
  navigationOpen: boolean;
  helpOpen: boolean;
  onOpenNavigation: () => void;
  onCloseNavigation: () => void;
  onInspect: () => void;
  onOpenCommand: () => void;
  onOpenHelp: () => void;
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
          aria-label="Open ProtoPeek overview"
          activeOptions={{ exact: true }}
        >
          <ProtoPeekMark />
          <strong>ProtoPeek</strong>
        </Link>
        <span className="pp-app-current">{props.activeLabel}</span>

        <nav className="pp-app-navigation" aria-label="Primary">
          {props.primaryNavigation.map((item) => {
            const Icon = primaryIcons[item.id];
            return (
              <Link
                key={item.id}
                to={item.route}
                className="pp-app-navigation-link"
                activeOptions={item.route === '/' ? { exact: true } : undefined}
                activeProps={{ className: 'is-active' }}
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
          {props.secondaryNavigation.map((item) => {
            const Icon = secondaryIcons[item.id];
            return (
              <Link
                key={item.id}
                to={item.route}
                className="pp-app-icon-action pp-app-secondary"
                activeProps={{ className: 'is-active' }}
                aria-label={`Open ${item.label}`}
              >
                <Icon aria-hidden="true" />
              </Link>
            );
          })}
          <button
            type="button"
            className="pp-app-icon-action pp-app-help"
            aria-label="Open ProtoPeek help"
            aria-expanded={props.helpOpen}
            onClick={props.onOpenHelp}
          >
            <CircleHelp aria-hidden="true" />
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
  primaryNavigation,
  secondaryNavigation,
  navigationOpen,
  onCloseNavigation,
  onInspect,
  onOpenHelp,
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
        <nav aria-label="Mobile primary">
          {primaryNavigation.map((item) => {
            const Icon = primaryIcons[item.id];
            return (
              <Link
                key={item.id}
                to={item.route}
                className="pp-navigation-link"
                activeOptions={item.route === '/' ? { exact: true } : undefined}
                activeProps={{ className: 'is-active' }}
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
          {secondaryNavigation.map((item) => {
            const Icon = secondaryIcons[item.id];
            return (
              <Link
                key={item.id}
                to={item.route}
                className="pp-navigation-link"
                onClick={onCloseNavigation}
              >
                <Icon aria-hidden="true" /> {item.label}
              </Link>
            );
          })}
          <button
            type="button"
            className="pp-navigation-link"
            onClick={() => closeThen(onOpenHelp)}
          >
            <CircleHelp aria-hidden="true" /> Help
          </button>
        </div>
        <footer>
          <Monitor aria-hidden="true" /> Local app · no account or cloud sync
        </footer>
      </aside>
    </div>
  );
}
