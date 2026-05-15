import React from 'react';
import ReactDOM from 'react-dom/client';
import 'react-toastify/dist/ReactToastify.css';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { RootApp } from './RootApp';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>,
);
