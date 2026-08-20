export function ProtoPeekMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M3.5 17h4l2.2-9 4.1 17 4.4-19 3.1 12H28.5"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="28.5" cy="18" r="1.6" fill="currentColor" />
    </svg>
  );
}
