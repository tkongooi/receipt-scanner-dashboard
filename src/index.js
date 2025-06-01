import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App'; // Assuming your main React component is in App.js

// Find the root DOM element where the React app will be mounted.
// This corresponds to <div id="root"></div> in your index.html.
const rootElement = document.getElementById('root');

// Create a React root. This is the new way to render React 18+ applications.
// It enables new concurrent features.
const root = ReactDOM.createRoot(rootElement);

// Render the main App component into the root.
// React.StrictMode is a tool for highlighting potential problems in an application.
// It activates additional checks and warnings for its descendants.
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// You might also see imports for a CSS file here (e.g., import './index.css';)
// if you have global styles defined in a separate CSS file.

