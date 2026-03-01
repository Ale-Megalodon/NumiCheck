import { useState } from "react";
import { BrandWordmark } from "./BrandWordmark";

export function SplashScreen() {
  const [logoError, setLogoError] = useState(false);

  return (
    <section className="splash-screen" aria-label="Pantalla de carga NumiCheck">
      <div className="splash-center">
        {logoError ? (
          <div className="splash-logo-fallback" aria-hidden="true">
            N
          </div>
        ) : (
          <img
            className="splash-logo-image"
            src="/img/logo.png"
            alt="Logo NumiCheck"
            onError={() => setLogoError(true)}
          />
        )}
        <BrandWordmark className="splash-wordmark" weight="bold" />
      </div>
    </section>
  );
}
