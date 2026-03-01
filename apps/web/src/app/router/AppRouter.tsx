import type { ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { LoginSkeleton } from "../../modules/auth/components/LoginSkeleton";
import { LoginPage } from "../../modules/auth/pages/LoginPage";
import { HomePage } from "../../modules/home/pages/HomePage";
import { useAuth } from "../providers/AuthProvider";

function AuthLandingRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <LoginSkeleton />
        </section>
      </main>
    );
  }

  return <Navigate to={user ? "/app" : "/login"} replace />;
}

function ProtectedRoute({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <LoginSkeleton />
        </section>
      </main>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function PublicRoute({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <LoginSkeleton />
        </section>
      </main>
    );
  }

  if (user) {
    return <Navigate to="/app" replace />;
  }

  return children;
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<AuthLandingRoute />} />
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
