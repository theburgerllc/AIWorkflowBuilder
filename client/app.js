// frontend/src/App.js
import React, { useEffect, useState } from 'react';
import mondaySdk from 'monday-sdk-js';
import AIAssistant from './components/AIAssistant';
import { MondayProvider } from './context/MondayContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Toaster } from 'react-hot-toast';
import './App.css';

// Initialize Monday SDK
const monday = mondaySdk();

function App() {
  const [context, setContext] = useState({});
  const [settings, setSettings] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Set up Monday SDK
    monday.setToken(process.env.REACT_APP_MONDAY_TOKEN);
    
    // Listen for context changes
    monday.listen('context', (res) => {
      setContext(res.data);
      setIsLoading(false);
    });

    // Listen for settings changes
    monday.listen('settings', (res) => {
      setSettings(res.data);
    });

    // Get initial context
    monday.get('context').then(res => {
      setContext(res.data);
      setIsLoading(false);
    }).catch(err => {
      setError('Failed to load Monday.com context');
      setIsLoading(false);
    });

    // Get initial settings
    monday.get('settings').then(res => {
      setSettings(res.data);
    });

  }, []);

  if (isLoading) {
    return (
      <div className="app-loading">
        <div className="loader"></div>
        <p>Connecting to Monday.com...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-error">
        <h2>Connection Error</h2>
        <p>{error}</p>
        <button onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <MondayProvider value={{ monday, context, settings }}>
        <div className="app">
          <header className="app-header">
            <h1>AI Assistant for Monday.com</h1>
            <p className="app-subtitle">
              Describe what you want to do in plain English
            </p>
          </header>
          
          <main className="app-main">
            <AIAssistant />
          </main>
          
          <Toaster 
            position="bottom-right"
            toastOptions={{
              duration: 4000,
              style: {
                background: '#333',
                color: '#fff',
              },
              success: {
                iconTheme: {
                  primary: '#00ca72',
                  secondary: '#fff',
                },
              },
              error: {
                iconTheme: {
                  primary: '#ff3333',
                  secondary: '#fff',
                },
              },
            }}
          />
        </div>
      </MondayProvider>
    </ErrorBoundary>
  );
}

export default App;