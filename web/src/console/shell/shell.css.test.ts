import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const shellStyles = readFileSync(resolve('web/src/console/shell/shell.css'), 'utf8');

describe('desktop shell layout contract', () => {
  it.each([
    { name: 'application bar', className: 'pp-app-bar', row: 1 },
    { name: 'canvas', className: 'pp-workbench-canvas', row: 1 },
    { name: 'status rail', className: 'pp-status-rail', row: 2 },
  ])('keeps the $name in explicit row $row', ({ className, row }) => {
    expect(shellStyles).toMatch(
      new RegExp(`\\.${className}\\s*\\{[^}]*grid-row:\\s*${row}(?: / -1)?;`, 's')
    );
  });

  it('keeps the live session announcement out of grid flow', () => {
    expect(shellStyles).toMatch(/\.pp-shell-announcement\s*\{[^}]*position:\s*absolute;/s);
  });

  it('puts sessions and destinations vertically beside the canvas', () => {
    expect(shellStyles).toMatch(/\.pp-app-navigation\s*\{[^}]*flex-direction:\s*column;/s);
    expect(shellStyles).toMatch(/\.pp-session-tabs\s*\{[^}]*flex-direction:\s*column;/s);
    expect(shellStyles).toMatch(/\.pp-workbench-canvas\s*\{[^}]*grid-column:\s*2;/s);
  });

  it('keeps the narrow destination drawer while hiding the desktop navigation', () => {
    const narrow = shellStyles.slice(
      shellStyles.indexOf('@media (max-width: 760px)'),
      shellStyles.indexOf('@keyframes pp-navigation-drawer-in')
    );

    expect(narrow).toMatch(/\.pp-app-navigation,[^{]*\{[^}]*display:\s*none;/s);
    expect(shellStyles).toMatch(/\.pp-navigation-drawer\s*\{/);
    expect(shellStyles).toMatch(/\.pp-navigation-link\s*\{/);
  });
});
