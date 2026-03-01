import { useEffect, useState } from "react";
import { AppRouter } from "../router/AppRouter";
import { SplashScreen } from "../../shared/components/ui/SplashScreen";

function isReloadNavigation() {
  const navigationEntries = window.performance.getEntriesByType("navigation");
  const firstEntry = navigationEntries[0] as PerformanceNavigationTiming | undefined;

  if (firstEntry?.type === "reload") {
    return true;
  }

  // Legacy fallback for older browsers.
  const legacyNavigation = (window.performance as Performance & {
    navigation?: { type?: number };
  }).navigation;
  return legacyNavigation?.type === 1;
}

export function AppEntry() {
  const [showSplash, setShowSplash] = useState(() => !isReloadNavigation());

  useEffect(() => {
    if (!showSplash) {
      return;
    }

    const timer = window.setTimeout(() => {
      setShowSplash(false);
    }, 6500);

    return () => window.clearTimeout(timer);
  }, [showSplash]);

  if (showSplash) {
    return <SplashScreen />;
  }

  return <AppRouter />;
}
