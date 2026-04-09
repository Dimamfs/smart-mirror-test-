import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { ModelSettingsProvider } from './contexts/ModelSettingsContext';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ModelSettingsProvider>
      <App />
    </ModelSettingsProvider>
  </React.StrictMode>
);
