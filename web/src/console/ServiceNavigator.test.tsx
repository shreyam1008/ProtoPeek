import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { BootstrapService } from '@/shared/types';

import { ServiceNavigator } from './ServiceNavigator';

describe('ServiceNavigator runtime work budget', () => {
  it('does not revisit the method catalog for an unrelated parent update', () => {
    let catalogReads = 0;
    const services = Array.from({ length: 64 }, (_, index) => {
      const methods = [
        {
          name: 'Check',
          fullName: `catalog.v1.Service${index}/Check`,
          description: '',
          clientStreaming: false,
          serverStreaming: false,
          requestType: 'catalog.v1.CheckRequest',
          responseType: 'catalog.v1.CheckResponse',
        },
      ];
      return {
        name: `catalog.v1.Service${index}`,
        description: '',
        get methods() {
          catalogReads += 1;
          return methods;
        },
      } satisfies BootstrapService;
    });
    const handlers = {
      onSearchChange: vi.fn(),
      onFilterChange: vi.fn(),
      onViewChange: vi.fn(),
      onExport: vi.fn(),
      onImport: vi.fn(),
    };
    const selectedFromFrame: number[] = [];

    function Harness() {
      const [healthFrame, setHealthFrame] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setHealthFrame((value) => value + 1)}>
            Advance health frame
          </button>
          <output aria-label="Health frame">{healthFrame}</output>
          <ServiceNavigator
            services={services}
            selectedMethod="catalog.v1.Service0/Check"
            searchText=""
            filter="all"
            activeView="tests"
            historyCount={0}
            savedCount={0}
            onSelectMethod={() => selectedFromFrame.push(healthFrame)}
            {...handlers}
          />
        </>
      );
    }

    render(<Harness />);
    const readsAfterInitialRender = catalogReads;
    expect(readsAfterInitialRender).toBeGreaterThanOrEqual(services.length);

    fireEvent.click(screen.getByRole('button', { name: 'Advance health frame' }));

    expect(screen.getByLabelText('Health frame')).toHaveTextContent('1');
    expect(catalogReads).toBe(readsAfterInitialRender);
    fireEvent.click(screen.getByText('Check'));
    expect(selectedFromFrame).toEqual([1]);
  });
});
