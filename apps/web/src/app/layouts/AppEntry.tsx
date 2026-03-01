import { useEffect, useState } from "react";
import { AppRouter } from "../router/AppRouter";
import { SplashScreen } from "../../shared/components/ui/SplashScreen";

export function AppEntry() {
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setShowSplash(false);
    }, 6500);

    return () => window.clearTimeout(timer);
  }, []);

  if (showSplash) {
    return <SplashScreen />;
  }

  return <AppRouter />;
}
