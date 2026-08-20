import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { HTTPWorkbench } from './HTTPWorkbench';

const httpQueryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 30_000 },
    mutations: { retry: false },
  },
});

export function HTTPRoute() {
  return (
    <QueryClientProvider client={httpQueryClient}>
      <HTTPWorkbench />
    </QueryClientProvider>
  );
}
