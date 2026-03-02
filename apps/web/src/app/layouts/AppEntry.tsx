import { useEffect, useState } from "react";
import { AppRouter } from "../router/AppRouter";
import { SplashScreen } from "../../shared/components/ui/SplashScreen";
import { useAuth } from "../providers/AuthProvider";
import {
  getPublicUserSettings,
  subscribePublicUserSettings
} from "../../modules/public/services/publicUserSettingsStore";

export function AppEntry() {
  const { user } = useAuth();
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

  useEffect(() => {
    const applyTheme = () => {
      const settings = user ? getPublicUserSettings(user.uid) : { darkMode: false };
      const root = document.documentElement;
      root.classList.toggle("theme-dark", settings.darkMode);
    };

    applyTheme();
    const unsubscribe = subscribePublicUserSettings(applyTheme);
    return unsubscribe;
  }, [user?.uid]);

  if (showSplash) {
    return <SplashScreen mode="short" />;
  }

  return <AppRouter />;
}
