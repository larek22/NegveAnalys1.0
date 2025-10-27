import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import ContractReviewPage from './pages/ContractReviewPage.jsx';
import DocumentAnalysisAdminPage from './pages/DocumentAnalysisAdminPage.jsx';
import { useTheme } from './hooks/useTheme.js';

const App = () => {
  const { theme, toggleTheme } = useTheme();

  return (
    <Routes>
      <Route index element={<ContractReviewPage theme={theme} onToggleTheme={toggleTheme} />} />
      <Route path="contracts" element={<ContractReviewPage theme={theme} onToggleTheme={toggleTheme} />} />
      <Route path="admin" element={<Navigate to="/admin77" replace />} />
      <Route path="admin77" element={<DocumentAnalysisAdminPage theme={theme} onToggleTheme={toggleTheme} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default App;
