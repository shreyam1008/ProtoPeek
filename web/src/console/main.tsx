import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@/shared/protopeek.css';

import { router } from './router';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('ProtoPeek root element not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
