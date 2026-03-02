import { BANKNOTE_OPTIONS } from "../constants/banknotes";

export function MainMenuSkeleton() {
  return (
    <>
      <div className="public-question-skeleton skeleton" aria-hidden="true" />

      <section className="banknotes-grid" aria-label="Cargando billetes">
        {BANKNOTE_OPTIONS.map((option) => (
          <article key={option.denomination} className={`banknote-tile banknote-tile--${option.denomination}`}>
            <div className="banknote-card banknote-card--skeleton skeleton" aria-hidden="true" />
            <div className="banknote-label-skeleton skeleton" aria-hidden="true" />
          </article>
        ))}
      </section>
    </>
  );
}

