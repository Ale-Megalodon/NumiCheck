import { useNavigate } from "react-router-dom";
import { BrandWordmark } from "../../../shared/components/ui/BrandWordmark";
import { BANKNOTE_OPTIONS } from "../constants/banknotes";
import { HamburgerMenu } from "../components/HamburgerMenu";

export function MainMenuPage() {
  const navigate = useNavigate();

  return (
    <main className="public-page">
      <section className="public-shell">
        <header className="public-header">
          <HamburgerMenu />
          <div className="public-brand">
            <img className="public-brand-logo" src="/img/logoNumiCheck.jpeg" alt="Logo NumiCheck" />
            <BrandWordmark className="public-brand-wordmark" weight="semibold" />
          </div>
        </header>

        <section className="banknotes-grid" aria-label="Seleccion de billetes">
          {BANKNOTE_OPTIONS.map((option) => (
            <button
              key={option.denomination}
              type="button"
              className="banknote-card"
              onClick={() => navigate(`/billete/${option.denomination}`)}
              aria-label={`Seleccionar ${option.label}`}
            >
              <img className="banknote-image" src={option.imageSrc} alt={`Billete ${option.label}`} />
              <span className="banknote-label">{option.label}</span>
            </button>
          ))}
        </section>
      </section>
    </main>
  );
}
