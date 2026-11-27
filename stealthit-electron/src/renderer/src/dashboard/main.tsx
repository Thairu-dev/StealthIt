import React from 'react';
import ReactDOM from 'react-dom/client';
import '../styles/globals.css';
import { DashboardApp } from './DashboardApp';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DashboardApp />
  </React.StrictMode>
);
