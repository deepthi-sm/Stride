import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { CalendarProvider } from './CalendarContext.jsx';
import { ThemeProvider } from './theme.jsx';
import './index.css';
import './design.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <CalendarProvider>
        <App />
      </CalendarProvider>
    </ThemeProvider>
  </React.StrictMode>
);
