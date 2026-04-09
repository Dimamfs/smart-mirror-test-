import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import SmartMirror from './pages/SmartMirror';
import Settings from './pages/Settings';
import Model from './pages/Model';
import ModelSettings from './pages/ModelSettings';
import { LanguageProvider } from './contexts/LanguageContext';

function App() {
  return (
    <LanguageProvider>
      <Router
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <div className="App">
          <Routes>
            <Route path="/" element={<SmartMirror />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/model" element={<Model />} />
            <Route path="/modelsettings" element={<ModelSettings />} />
          </Routes>
        </div>
      </Router>
    </LanguageProvider>
  );
}

export default App;
