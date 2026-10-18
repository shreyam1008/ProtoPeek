import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePagination } from './use-pagination';

const evidence = Array.from({ length: 125 }, (_, index) => ({ id: index + 1 }));

describe('local pagination', () => {
  it('pages original rows in order and bounds both controls', () => {
    const { result } = renderHook(() => usePagination(evidence));
    expect(result.current.pageItems).toEqual(evidence.slice(0, 50));
    expect(result.current.pageItems[0]).toBe(evidence[0]);
    expect(result.current.pageCount).toBe(3);
    expect(result.current.canPreviousPage).toBe(false);
    expect(result.current.canNextPage).toBe(true);
    act(() => result.current.previousPage());
    expect(result.current.pageIndex).toBe(0);
    act(() => result.current.nextPage());
    expect(result.current.pageItems).toEqual(evidence.slice(50, 100));
    expect(result.current.pageOffset).toBe(50);
    act(() => result.current.nextPage());
    expect(result.current.pageItems).toEqual(evidence.slice(100));
    expect(result.current.canNextPage).toBe(false);
    act(() => result.current.nextPage());
    expect(result.current.pageIndex).toBe(2);
    act(() => result.current.previousPage());
    expect(result.current.pageIndex).toBe(1);
  });

  it('supports consecutive updates without dropping an advance', () => {
    const { result } = renderHook(() => usePagination(evidence));
    act(() => {
      result.current.nextPage();
      result.current.nextPage();
    });
    expect(result.current.pageIndex).toBe(2);
  });

  it('renders empty evidence with disabled navigation', () => {
    const empty: number[] = [];
    const { result } = renderHook(() => usePagination(empty));
    expect(result.current.pageItems).toEqual([]);
    expect(result.current.pageIndex).toBe(0);
    expect(result.current.pageCount).toBe(0);
    expect(result.current.canPreviousPage).toBe(false);
    expect(result.current.canNextPage).toBe(false);
    act(() => result.current.setPageIndex(4));
    expect(result.current.pageIndex).toBe(0);
  });

  it('does not create an extra page for an exact multiple', () => {
    const items = evidence.slice(0, 100);
    const { result } = renderHook(() => usePagination(items));
    act(() => result.current.nextPage());
    expect(result.current.pageCount).toBe(2);
    expect(result.current.canNextPage).toBe(false);
    expect(result.current.pageItems).toHaveLength(50);
  });

  it('resets replacement evidence and filters before rendering stale pages', () => {
    const { result, rerender } = renderHook(({ items }) => usePagination(items), {
      initialProps: { items: evidence },
    });
    act(() => result.current.setPageIndex(2));
    rerender({ items: [...evidence] });
    expect(result.current.pageIndex).toBe(0);
    act(() => result.current.nextPage());
    rerender({ items: evidence.slice(70, 80) });
    expect(result.current.pageIndex).toBe(0);
    expect(result.current.pageItems).toEqual(evidence.slice(70, 80));
  });

  it('keeps the page on unrelated renders with the same evidence', () => {
    const { result, rerender } = renderHook(() => usePagination(evidence));
    act(() => result.current.nextPage());
    rerender();
    expect(result.current.pageIndex).toBe(1);
  });

  it('preserves a live queue page on refresh, then clamps and remembers shrinkage', () => {
    const { result, rerender } = renderHook(
      ({ items }) => usePagination(items, { resetOnChange: false }),
      { initialProps: { items: evidence } }
    );
    act(() => result.current.setPageIndex(2));
    rerender({ items: [...evidence] });
    expect(result.current.pageIndex).toBe(2);
    rerender({ items: evidence.slice(0, 60) });
    expect(result.current.pageIndex).toBe(1);
    expect(result.current.pageItems).toEqual(evidence.slice(50, 60));
    rerender({ items: evidence });
    expect(result.current.pageIndex).toBe(1);
    act(() => result.current.setPageIndex(0));
    expect(result.current.pageIndex).toBe(0);
  });

  it('clamps a removed queue to its first page and recovers when items return', () => {
    const { result, rerender } = renderHook(
      ({ items }) => usePagination(items, { resetOnChange: false }),
      { initialProps: { items: evidence } }
    );
    act(() => result.current.nextPage());
    rerender({ items: [] });
    expect(result.current.pageIndex).toBe(0);
    expect(result.current.pageItems).toEqual([]);
    rerender({ items: evidence });
    expect(result.current.pageIndex).toBe(0);
  });

  it('bounds direct page selection and safely handles malformed sizes', () => {
    const { result, rerender } = renderHook(
      ({ pageSize }) => usePagination(evidence, { pageSize }),
      { initialProps: { pageSize: 25 } }
    );
    act(() => result.current.setPageIndex(100));
    expect(result.current.pageIndex).toBe(4);
    act(() => result.current.setPageIndex(-3));
    expect(result.current.pageIndex).toBe(0);
    act(() => result.current.setPageIndex(1.5));
    expect(result.current.pageIndex).toBe(1);
    act(() => result.current.setPageIndex(Number.NaN));
    expect(result.current.pageIndex).toBe(0);
    rerender({ pageSize: 0 });
    expect(result.current.pageItems).toHaveLength(1);
    rerender({ pageSize: Number.POSITIVE_INFINITY });
    expect(result.current.pageItems).toHaveLength(50);
  });
});
