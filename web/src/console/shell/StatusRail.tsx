export function StatusRail({ currentLabel }: { currentLabel: string }) {
  return (
    <section className="pp-status-rail" aria-label="Workbench status">
      <span>
        <b>View</b> {currentLabel}
      </span>
      <span>
        <b>Operations</b> Manual and bounded
      </span>
      <span>
        <b>Refresh</b> No background polling
      </span>
      <span className="pp-status-rail-local">Local-first · cross-platform shell</span>
    </section>
  );
}
