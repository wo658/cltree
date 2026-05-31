import './monaco-workers';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';

/**
 * Initialize mock server only when VITE_USE_MOCK=true.
 * By default, connects to the real NestJS server.
 */
async function bootstrap() {
  if (import.meta.env.VITE_USE_MOCK === 'true') {
    const { initMockServer } = await import('./mocks/mock-server');
    initMockServer();
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

bootstrap();
