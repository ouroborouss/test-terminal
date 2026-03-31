import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/jetbrains-mono/700.css';
import { CliOverlay } from './components/CliOverlay';
import './cli.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CliOverlay />
  </React.StrictMode>
);
