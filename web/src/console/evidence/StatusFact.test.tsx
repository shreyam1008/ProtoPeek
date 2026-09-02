import { render } from '@testing-library/react';
import { expect, it } from 'vitest';

import { StatusFact } from './StatusFact';

it('preserves native description-list structure and domain class hooks', () => {
  const { container } = render(
    <dl>
      <StatusFact
        className="is-warning"
        label={<span>Runtime state</span>}
        value={<strong>Unavailable</strong>}
      />
    </dl>
  );

  const fact = container.querySelector('dl')?.firstElementChild;
  expect(fact).toHaveClass('is-warning');
  expect(fact?.tagName).toBe('DIV');
  expect(fact?.children).toHaveLength(2);
  expect(fact?.children[0]?.tagName).toBe('DT');
  expect(fact?.children[0]).toHaveTextContent('Runtime state');
  expect(fact?.children[1]?.tagName).toBe('DD');
  expect(fact?.children[1]).toHaveTextContent('Unavailable');
});
