import { useEffect, useState } from "react";
import { AppRouter } from "../router/AppRouter";
import { SplashScreen } from "../../shared/components/ui/SplashScreen";
import { useAuth } from "../providers/AuthProvider";

export function AppEntry() {
  const { user, loading } = useAuth();
  const [splashMode, setSplashMode] = useState<"pending" | "none" | "long" | "short">("pending");

  useEffect(() => {
    if (loading) {
      return;
    }

    const hasSeenApp = window.localStorage.getItem("numicheck_seen_once") === "1";

    if (!hasSeenApp && !user) {
      window.localStorage.setItem("numicheck_seen_once", "1");
      setSplashMode("long");
      return;
    }

    if (user) {
      setSplashMode("short");
      return;
    }

    setSplashMode("none");
  }, [loading, user]);

  useEffect(() => {
    if (splashMode === "none" || splashMode === "pending") {
      return;
    }

    const duration = splashMode === "long" ? 4000 : 1500;
    const timer = window.setTimeout(() => {
      setSplashMode("none");
    }, duration);

    return () => window.clearTimeout(timer);
  }, [splashMode]);

  if (splashMode === "pending") {
    return <div className="status-screen">Cargando...</div>;
  }

  if (splashMode === "long" || splashMode === "short") {
    return <SplashScreen mode={splashMode} />;
  }

  return <AppRouter />;
}
