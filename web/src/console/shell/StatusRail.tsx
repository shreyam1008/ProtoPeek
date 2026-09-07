export function StatusRail({ currentLabel }: { currentLabel: string }) {
  return (
    <section className="pp-status-rail" aria-label="Workbench status">
      <span>
        <b>View</b> {currentLabel}
      </span>
      <span className="pp-status-rail-local">Local workspace</span>
    </section>
  );
}
