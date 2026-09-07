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
import { type ReactNode, useRef } from 'react';
import type { DestinationDefinition, DestinationId } from '../app/feature-registry';
import { ProtoPeekMark } from '../ProtoPeekMark';
import { useDialogFocus } from '../use-dialog-focus';
import { ToolNavigation } from './ToolNavigation';
import type { DestinationRoutes } from './tool-navigation';

const destinationIcons: Record<DestinationDefinition['icon'], LucideIcon> = {
  home: Home,
  search: Search,
  network: Network,
  cloud: Cloud,
  download: Download,
  settings: SettingsIcon,
};
const descriptions: Record<DestinationId, string> = {
  home: 'Your service workbench',
  inspect: 'Requests & responses',
  network: 'Devices, paths & services',
  publish: 'Expose a local service',
  files: 'Downloads & transfers',
  settings: 'Make it your workspace',
};
export type AppBarProps = {
  children?: ReactNode;
  destinations: readonly DestinationDefinition[];
  destinationRoutes?: DestinationRoutes;
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
  const destination = props.destinations.find((item) => item.id === props.activeDestinationId);
  return (
    <>
      <header className="pp-app-bar">
        <div className="pp-destination-rail">
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
          <nav className="pp-app-navigation" aria-label="Destinations">
            {props.destinations.map((item) => {
              const Icon = destinationIcons[item.icon];
              const active = item.id === props.activeDestinationId;
              return (
                <Link
                  key={item.id}
                  to={props.destinationRoutes?.[item.id] ?? item.route}
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
          <span className="pp-app-current">{props.activeLabel}</span>
          <div className="pp-rail-actions">
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
        </div>
        <div className="pp-tool-sidebar">
          <div className="pp-tool-sidebar-heading">
            <strong>{destination?.label ?? 'Workspace'}</strong>
            <span>{destination ? descriptions[destination.id] : 'Choose a tool to begin'}</span>
          </div>
          <button
            type="button"
            className="pp-app-command"
            aria-label="Open global command menu"
            onClick={props.onOpenCommand}
          >
            <Search aria-hidden="true" />
            <span>Find anything</span>
            <kbd>{props.modifier} K</kbd>
          </button>
          <div className="pp-tool-sidebar-content">
            {destination ? <ToolNavigation destination={destination.id} /> : null}
            {!props.navigationOpen ? (
              <details className="pp-recent-workspaces">
                <summary>Recent workspaces</summary>
                {props.children}
              </details>
            ) : null}
          </div>
          <div className="pp-app-actions">
            <button type="button" className="pp-app-inspect" onClick={props.onInspect}>
              <Radar aria-hidden="true" />
              <span>Inspect target</span>
            </button>
            <span className="pp-sidebar-local">
              <Monitor aria-hidden="true" /> Local workspace
            </span>
          </div>
        </div>
      </header>
      <MobileNavigationDrawer {...props} />
    </>
  );
}

function MobileNavigationDrawer(props: AppBarProps) {
  const drawerRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  useDialogFocus(props.navigationOpen, props.onCloseNavigation, drawerRef, closeButtonRef);
  if (!props.navigationOpen) return null;
  return (
    <div className="pp-navigation-layer">
      <button
        type="button"
        className="pp-navigation-backdrop"
        aria-label="Close navigation menu"
        onClick={props.onCloseNavigation}
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
            <strong id="protopeek-mobile-navigation-title">ProtoPeek</strong>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="pp-navigation-close"
            aria-label="Close navigation menu"
            onClick={props.onCloseNavigation}
          >
            <X aria-hidden="true" />
          </button>
        </header>
        <button
          type="button"
          className="pp-navigation-link"
          onClick={() => {
            props.onCloseNavigation();
            props.onOpenCommand();
          }}
        >
          <Search aria-hidden="true" />
          Find commands
        </button>
        <nav aria-label="Mobile destinations">
          {props.destinations.map((item) => {
            const Icon = destinationIcons[item.icon];
            return (
              <Link
                key={item.id}
                to={props.destinationRoutes?.[item.id] ?? item.route}
                className={`pp-navigation-link${item.id === props.activeDestinationId ? ' is-active' : ''}`}
                aria-current={item.id === props.activeDestinationId ? 'page' : undefined}
                activeOptions={{ exact: true }}
                onClick={props.onCloseNavigation}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        {props.activeDestinationId ? (
          <ToolNavigation
            destination={props.activeDestinationId}
            onNavigate={props.onCloseNavigation}
          />
        ) : null}
        <details className="pp-recent-workspaces">
          <summary>Recent workspaces</summary>
          {props.children}
        </details>
        <div className="pp-navigation-actions">
          <button
            type="button"
            className="pp-navigation-link"
            onClick={() => {
              props.onCloseNavigation();
              props.onInspect();
            }}
          >
            <Radar aria-hidden="true" />
            Inspect target
          </button>
        </div>
        <footer>
          <Monitor aria-hidden="true" />
          Local workspace
        </footer>
      </aside>
    </div>
  );
}
