import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@/shared/protopeek.css';

import { App } from './App';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('ProtoPeek site root element not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
