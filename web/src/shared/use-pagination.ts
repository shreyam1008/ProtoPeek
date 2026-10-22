import { useState } from 'react';

/** Bounded local pagination; replacing evidence resets pages unless a live queue opts out. */
export function usePagination<T>(
  items: readonly T[],
  { pageSize = 50, resetOnChange = true }: { pageSize?: number; resetOnChange?: boolean } = {}
) {
  const size = Number.isFinite(pageSize) ? Math.max(1, Math.trunc(pageSize)) : 50;
  const pageCount = Math.ceil(items.length / size);
  const lastPage = Math.max(0, pageCount - 1);
  const [state, setState] = useState({ items, size, pageIndex: 0 });
  let pageIndex = Math.min(state.pageIndex, lastPage);

  // Keep rendered rows and controls consistent in the same render, including after a queue shrinks.
  if (state.items !== items || state.size !== size) {
    pageIndex = resetOnChange ? 0 : pageIndex;
    setState({ items, size, pageIndex });
  }

  function setPageIndex(next: number | ((current: number) => number)) {
    setState((current) => {
      const value = typeof next === 'function' ? next(current.pageIndex) : next;
      const index = Number.isFinite(value) ? Math.trunc(value) : 0;
      return { items, size, pageIndex: Math.max(0, Math.min(index, lastPage)) };
    });
  }

  const pageOffset = pageIndex * size;
  return {
    pageItems: items.slice(pageOffset, pageOffset + size),
    pageIndex,
    pageCount,
    pageOffset,
    canPreviousPage: pageIndex > 0,
    canNextPage: pageIndex < lastPage,
    setPageIndex,
    previousPage: () => setPageIndex((current) => current - 1),
    nextPage: () => setPageIndex((current) => current + 1),
  };
}
