import { readFileSync } from 'node:fs';
import path from 'node:path';

const securityStyles = readFileSync(
  path.resolve(process.cwd(), 'web/src/console/security.css'),
  'utf8'
);

describe('security responsive and accessibility styles', () => {
  it('keeps semantic colors, narrow layouts, focus visibility, and reduced motion support', () => {
    expect(securityStyles).toContain('var(--pp-canvas)');
    expect(securityStyles).toContain('var(--pp-accent-signal)');
    expect(securityStyles).toContain('@media (max-width: 900px)');
    expect(securityStyles).toContain('@media (max-width: 640px)');
    expect(securityStyles).toContain(':focus-visible');
    expect(securityStyles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(securityStyles).toContain('content-visibility: auto');
    expect(securityStyles).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});
