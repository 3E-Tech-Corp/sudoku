import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Landing from './pages/Landing';
import GameLobby from './pages/GameLobby';
import GameRouter from './pages/GameRouter';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-lg">Loading...</div>
      </div>
    );
  }

  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
}

export default function App() {
  return (
    <Routes>
      {/* Public routes - Game platform */}
      <Route path="/" element={<Landing />} />
      <Route path="/games/:gameId" element={<GameLobby />} />
      <Route path="/room/:code" element={<GameRouter />} />

      {/* Auth routes */}
      <Route path="/login" element={<Login />} />

      {/* Protected admin routes */}
      <Route
        path="/admin"
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route index element={<Dashboard />} />
      </Route>

      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}
