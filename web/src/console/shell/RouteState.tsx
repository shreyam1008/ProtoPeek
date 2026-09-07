import { type ErrorComponentProps, Link, useRouter } from '@tanstack/react-router';
import { CircleAlert, LoaderCircle } from 'lucide-react';

export function RoutePending() {
  return (
    <section className="pp-route-state" role="status">
      <LoaderCircle data-loading aria-hidden="true" />
      <h1>Opening workspace</h1>
      <p>Loading this tool. Your navigation stays available.</p>
    </section>
  );
}

export function RouteError({ reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <section className="pp-route-state" role="alert">
      <CircleAlert aria-hidden="true" />
      <h1>This workspace could not open</h1>
      <p>Try loading it again. Saved work remains in its usual local storage.</p>
      <button
        type="button"
        onClick={() => {
          void router.invalidate().then(reset);
        }}
      >
        Try again
      </button>
      <Link to="/">Go to Home</Link>
    </section>
  );
}

export function RouteNotFound() {
  return (
    <section className="pp-route-state">
      <CircleAlert aria-hidden="true" />
      <h1>Workspace not found</h1>
      <p>Choose a tool from the navigator or return to Home.</p>
      <Link to="/">Go to Home</Link>
    </section>
  );
}
