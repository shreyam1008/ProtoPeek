import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve('web/src/console/tunnels.css'), 'utf8');

describe('tunnel responsive actions', () => {
  it('keeps non-toolbar action labels visible at narrow widths', () => {
    const narrow = styles.slice(styles.indexOf('@media (max-width: 820px)'));

    expect(narrow).toContain('.pp-tunnel-toolbar > .pp-tunnel-button {');
    expect(narrow).toContain('.pp-tunnel-toolbar > .pp-tunnel-button-primary {');
    expect(narrow).not.toMatch(/\n\s*\.pp-tunnel-button\s*\{/);
    expect(narrow).not.toMatch(/\n\s*\.pp-tunnel-button-primary\s*\{/);
  });
});
