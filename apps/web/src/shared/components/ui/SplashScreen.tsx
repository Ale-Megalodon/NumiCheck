import { BrandWordmark } from "./BrandWordmark";

type SplashScreenProps = {
  mode: "long" | "short";
};

export function SplashScreen({ mode }: SplashScreenProps) {
  return (
    <section className={`splash-screen splash-screen--${mode}`} aria-label="Pantalla de carga NumiCheck">
      <div className="splash-center">
        <img className="splash-logo-image" src="/img/logoNumiCheck.jpeg" alt="Logo NumiCheck" />
        <BrandWordmark className="splash-wordmark" weight="bold" />
      </div>
    </section>
  );
}
