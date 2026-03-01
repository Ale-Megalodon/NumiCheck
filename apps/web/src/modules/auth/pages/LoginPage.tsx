import { useEffect, useState } from "react";
import { useAuth } from "../../../app/providers/AuthProvider";
import { LoginSkeleton } from "../components/LoginSkeleton";
import { BrandWordmark } from "../../../shared/components/ui/BrandWordmark";

export function LoginPage() {
  const { loginWithGoogle, loginWithFacebook } = useAuth();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loadingProvider, setLoadingProvider] = useState<"google" | "facebook" | null>(null);
  const [uiLoading, setUiLoading] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setUiLoading(false);
    }, 550);

    return () => window.clearTimeout(timer);
  }, []);

  const handleLogin = async (provider: "google" | "facebook") => {
    setErrorMessage(null);
    setLoadingProvider(provider);

    try {
      if (provider === "google") {
        await loginWithGoogle();
      } else {
        await loginWithFacebook();
      }
    } catch {
      setErrorMessage("No pudimos iniciar sesion. Intenta nuevamente.");
    } finally {
      setLoadingProvider(null);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-card">
        {uiLoading ? (
          <LoginSkeleton />
        ) : (
          <>
            <BrandWordmark className="auth-title-logo" weight="bold" />
            <p className="auth-subtitle">Accede para validar billetes por numero de serie.</p>

            <button
              type="button"
              className="auth-button"
              onClick={() => handleLogin("google")}
              disabled={loadingProvider !== null}
            >
              {loadingProvider === "google" ? "Conectando..." : "Iniciar con Google"}
            </button>

            <button
              type="button"
              className="auth-button"
              onClick={() => handleLogin("facebook")}
              disabled={loadingProvider !== null}
            >
              {loadingProvider === "facebook" ? "Conectando..." : "Iniciar con Facebook"}
            </button>

            {errorMessage ? <p className="auth-error">{errorMessage}</p> : null}
          </>
        )}
      </section>
    </main>
  );
}
