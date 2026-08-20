import { StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';

import '@/shared/protopeek.css';

import { App } from './App';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('ProtoPeek site root element not found.');
}

hydrateRoot(
  rootElement,
  <StrictMode>
    <App />
  </StrictMode>
);
