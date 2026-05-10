// frontend/src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/layout/Layout';
import EvalsDashboard from './pages/EvalsDashboard';
import EvalResults from './pages/EvalResults';

function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/evals" replace />} />
          <Route path="/evals" element={<EvalsDashboard />} />
          <Route path="/evals/:id" element={<EvalResults />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
