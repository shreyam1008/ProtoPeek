import { Link, useLocation } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { type DestinationId, featureForPath } from '../app/feature-registry';
import { toolGroups, toolsForGroup } from './tool-navigation';

export function ToolNavigation({
  destination,
  onNavigate,
}: {
  destination: DestinationId;
  onNavigate?: () => void;
}) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const active = featureForPath(pathname);
  return (
    <nav
      className="pp-tool-navigation"
      aria-label={`${destination === 'home' ? 'Home' : destination[0].toUpperCase() + destination.slice(1)} tools`}
    >
      {toolGroups[destination].map((group) => (
        <div className="pp-tool-group" key={group.label}>
          <span className="pp-tool-group-label">{group.label}</span>
          {toolsForGroup(group.ids).map((feature) => (
            <Link
              key={feature.id}
              to={feature.route}
              className={`pp-tool-link${active?.id === feature.id ? ' is-active' : ''}`}
              aria-current={active?.id === feature.id ? 'page' : undefined}
              activeOptions={{ exact: true }}
              onClick={onNavigate}
            >
              <span>
                {feature.id === 'protocols'
                  ? 'Overview'
                  : feature.id === 'overview'
                    ? 'Start'
                    : feature.label}
              </span>
              {active?.id === feature.id ? <ChevronRight aria-hidden="true" /> : null}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
