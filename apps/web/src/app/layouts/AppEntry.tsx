import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { AppRouter } from "../router/AppRouter";
import { SplashScreen } from "../../shared/components/ui/SplashScreen";

export function AppEntry() {
  const location = useLocation();
  const isAdminRoute = location.pathname === "/control-interno-nc-a73k9q";
  const [showSplash, setShowSplash] = useState(() => !isAdminRoute);

  useEffect(() => {
    if (isAdminRoute) {
      setShowSplash(false);
      return;
    }

    setShowSplash(true);
    const timer = window.setTimeout(() => {
      setShowSplash(false);
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [isAdminRoute, location.pathname]);

  if (showSplash) {
    return <SplashScreen mode="short" />;
  }

  return <AppRouter />;
}
