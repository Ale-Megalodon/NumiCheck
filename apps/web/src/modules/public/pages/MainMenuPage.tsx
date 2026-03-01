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

        <p className="public-question">¿Qué billete deseas escanear?</p>

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
      </section>
    </main>
  );
}
