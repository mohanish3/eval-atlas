// frontend/src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/layout/Layout';
import EvalsDashboard from './pages/EvalsDashboard';
import EvalResults from './pages/EvalResults';
import EvalSetBuilder from './pages/EvalSetBuilder';
import EvalSetsPage from './pages/EvalSetsPage';
import EvalConfigPage from './pages/EvalConfigPage';

function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/evals" replace />} />
          <Route path="/evals" element={<EvalsDashboard />} />
          <Route path="/evals/sets" element={<EvalSetsPage />} />
          <Route path="/evals/config" element={<EvalConfigPage />} />
          <Route path="/evals/builder/new" element={<EvalSetBuilder />} />
          <Route path="/evals/builder/:evalSetId" element={<EvalSetBuilder />} />
          <Route path="/evals/:id" element={<EvalResults />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
