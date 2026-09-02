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
});
