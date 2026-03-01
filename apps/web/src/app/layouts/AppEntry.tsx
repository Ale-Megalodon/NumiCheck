import { useEffect, useState } from "react";
import { AppRouter } from "../router/AppRouter";
import { SplashScreen } from "../../shared/components/ui/SplashScreen";

export function AppEntry() {
  const splashDurationMs = 4500;
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setShowSplash(false);
    }, splashDurationMs);

    return () => window.clearTimeout(timer);
  }, [splashDurationMs]);

  if (showSplash) {
    return <SplashScreen />;
  }

  return <AppRouter />;
}
