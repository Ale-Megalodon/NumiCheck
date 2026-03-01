import { BrandWordmark } from "./BrandWordmark";

export function SplashScreen() {
  return (
    <section className="splash-screen" aria-label="Pantalla de carga NumiCheck">
      <div className="splash-center">
        <img className="splash-logo-image" src="/img/logoNumiCheck.jpeg" alt="Logo NumiCheck" />
        <BrandWordmark className="splash-wordmark" weight="bold" />
      </div>
    </section>
  );
}
