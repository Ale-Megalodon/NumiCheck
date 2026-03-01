import type { ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { LoginPage } from "../../modules/auth/pages/LoginPage";
import { HomePage } from "../../modules/home/pages/HomePage";
import { useAuth } from "../providers/AuthProvider";

function ProtectedRoute({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="status-screen">Loading session...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function PublicRoute({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="status-screen">Loading session...</div>;
  }

  if (user) {
    return <Navigate to="/app" replace />;
  }

  return children;
}

export function AppRouter() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        }
      />
      <Route
        path="/app"
        element={
          <ProtectedRoute>
            <HomePage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}