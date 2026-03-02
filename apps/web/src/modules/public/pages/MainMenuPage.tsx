import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../app/providers/AuthProvider";
import { MainMenuSkeleton } from "../components/MainMenuSkeleton";
import { HamburgerMenu } from "../components/HamburgerMenu";
import { PublicBrand } from "../components/PublicBrand";
import { BANKNOTE_OPTIONS } from "../constants/banknotes";

const ASSET_SOURCES = ["/img/logoNumiCheck.jpeg", ...BANKNOTE_OPTIONS.map((item) => item.imageSrc)];

function preloadAssets(sources: string[]) {
  return Promise.all(
    sources.map(
      (source) =>
        new Promise<void>((resolve) => {
          const image = new Image();
          image.onload = () => resolve();
          image.onerror = () => resolve();
          image.src = source;
        })
    )
  );
}

export function MainMenuPage() {
  const navigate = useNavigate();
  const { loading, user } = useAuth();
  const [assetsReady, setAssetsReady] = useState(false);
  const [showBackExitHint, setShowBackExitHint] = useState(false);
  const backGuardUntilRef = useRef(0);
  const backHintTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;
    preloadAssets(ASSET_SOURCES).then(() => {
      if (mounted) {
        setAssetsReady(true);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!assetsReady) {
      return;
    }

    const currentState = (window.history.state as Record<string, unknown> | null) ?? {};
    if (!currentState.ncBackGuard) {
      window.history.pushState({ ...currentState, ncBackGuard: true }, "", window.location.href);
    }

    const handlePopState = () => {
      const now = Date.now();

      if (backGuardUntilRef.current > now) {
        if (backHintTimerRef.current) {
          window.clearTimeout(backHintTimerRef.current);
          backHintTimerRef.current = null;
        }
        setShowBackExitHint(false);
        backGuardUntilRef.current = 0;
        window.removeEventListener("popstate", handlePopState);
        window.history.back();
        return;
      }

      backGuardUntilRef.current = now + 2200;
      setShowBackExitHint(true);

      if (backHintTimerRef.current) {
        window.clearTimeout(backHintTimerRef.current);
      }

      backHintTimerRef.current = window.setTimeout(() => {
        setShowBackExitHint(false);
        backGuardUntilRef.current = 0;
        backHintTimerRef.current = null;
      }, 2200);

      const nextState = (window.history.state as Record<string, unknown> | null) ?? {};
      window.history.pushState({ ...nextState, ncBackGuard: true }, "", window.location.href);
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      if (backHintTimerRef.current) {
        window.clearTimeout(backHintTimerRef.current);
        backHintTimerRef.current = null;
      }
    };
  }, [assetsReady]);

  const showSkeleton = loading || !assetsReady;

  return (
    <main className="public-page">
      <section className="public-shell">
        <header className="public-header">
          <HamburgerMenu />
          <PublicBrand loading={showSkeleton} user={user} />
        </header>

        {showSkeleton ? (
          <MainMenuSkeleton />
        ) : (
          <>
            <p className="public-question">Que billete deseas escanear?</p>

            <section className="banknotes-grid" aria-label="Seleccion de billetes">
              {BANKNOTE_OPTIONS.map((option) => (
                <article key={option.denomination} className={`banknote-tile banknote-tile--${option.denomination}`}>
                  <button
                    type="button"
                    className="banknote-card"
                    onClick={() => navigate(`/billete/${option.denomination}`)}
                    aria-label={`Seleccionar ${option.label}`}
                  >
                    <img className="banknote-image" src={option.imageSrc} alt={`Billete ${option.label}`} />
                  </button>
                  <span className="banknote-label">{option.label}</span>
                </article>
              ))}
            </section>
          </>
        )}
      </section>

      {showBackExitHint ? <div className="exit-hint-toast">Presione de nuevo para salir</div> : null}
    </main>
  );
}
