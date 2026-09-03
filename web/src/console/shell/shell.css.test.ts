import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const shellStyles = readFileSync(resolve('web/src/console/shell/shell.css'), 'utf8');

describe('desktop shell layout contract', () => {
  it.each([
    { name: 'application bar', className: 'pp-app-bar', row: 1 },
    { name: 'session strip', className: 'pp-session-strip', row: 2 },
    { name: 'canvas', className: 'pp-workbench-canvas', row: 3 },
    { name: 'status rail', className: 'pp-status-rail', row: 4 },
  ])('keeps the $name in explicit row $row', ({ className, row }) => {
    expect(shellStyles).toMatch(new RegExp(`\\.${className}\\s*\\{[^}]*grid-row:\\s*${row};`, 's'));
  });

  it('keeps the live session announcement out of grid flow', () => {
    expect(shellStyles).toMatch(/\.pp-shell-announcement\s*\{[^}]*position:\s*absolute;/s);
  });

  it('keeps destination labels naturally sized from 761 through 1119 pixels', () => {
    const compactDesktop = shellStyles.slice(
      shellStyles.indexOf('@media (min-width: 761px) and (max-width: 1119px)'),
      shellStyles.indexOf('@media (max-width: 760px)')
    );

    expect(compactDesktop).toContain('.pp-app-brand strong');
    expect(compactDesktop).toContain('.pp-app-command span');
    expect(compactDesktop).not.toContain('.pp-app-navigation-link span');
    expect(compactDesktop).not.toMatch(/\.pp-app-navigation-link[^}]*width:/s);
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
