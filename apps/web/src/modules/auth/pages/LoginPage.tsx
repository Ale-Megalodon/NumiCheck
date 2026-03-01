import { useState } from "react";
import { useAuth } from "../../../app/providers/AuthProvider";

export function LoginPage() {
  const { loginWithGoogle, loginWithFacebook } = useAuth();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loadingProvider, setLoadingProvider] = useState<"google" | "facebook" | null>(null);

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
        <h1 className="auth-title">NumiCheck</h1>
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
      </section>
    </main>
  );
}