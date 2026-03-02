import { useEffect, useState } from "react";
import { AppRouter } from "../router/AppRouter";
import { SplashScreen } from "../../shared/components/ui/SplashScreen";

export function AppEntry() {
  const initialPath = window.location.hash.replace(/^#/, "") || "/";
  const shouldShowSplashOnBoot = initialPath !== "/control-interno-nc-a73k9q";
  const [showSplash, setShowSplash] = useState(shouldShowSplashOnBoot);

  useEffect(() => {
    if (!shouldShowSplashOnBoot) {
      return;
    }

    const timer = window.setTimeout(() => {
      setShowSplash(false);
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [shouldShowSplashOnBoot]);

  if (showSplash) {
    return <SplashScreen mode="short" />;
  }

  return <AppRouter />;
}
