import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { CalendarProvider } from './CalendarContext.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <CalendarProvider>
      <App />
    </CalendarProvider>
  </React.StrictMode>
);
