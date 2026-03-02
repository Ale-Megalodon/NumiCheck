import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../app/providers/AuthProvider";
import { BackHomeButton } from "../components/BackHomeButton";
import { HamburgerMenu } from "../components/HamburgerMenu";
import { PublicBrand } from "../components/PublicBrand";

type SectionKey = "scan" | "tuning" | "contact";

type GuideStep = {
  title: string;
  body: string;
};

const SCAN_STEPS: GuideStep[] = [
  {
    title: "Paso 1: Encuadre rapido",
    body: "Abre un billete (10, 20 o 50), pulsa Escanear y alinea solo el numero de serie en el recuadro."
  },
  {
    title: "Paso 2: Luz y estabilidad",
    body: "Usa buena luz, evita reflejos y manten el telefono quieto entre 1 y 2 segundos para subir confianza."
  },
  {
    title: "Paso 3: Confirmacion",
    body: "Si aparece Tu serie X-B, revisa el porcentaje y pulsa Verificar numero de serie para obtener resultado verde/rojo."
  }
];

const TUNING_STEPS: GuideStep[] = [
  {
    title: "Paso 1: Modo simple",
    body: "En Configuracion, primero ajusta readHitDelayMs y fastAcceptConfidence para controlar velocidad y precision."
  },
  {
    title: "Paso 2: Ajustes avanzados",
    body: "Activa Mostrar ajustes avanzados solo si quieres afinar tiempos OCR y calidad minima en tu cuenta."
  },
  {
    title: "Paso 3: Guardar y probar",
    body: "Pulsa Guardar velocidad y vuelve a escanear el mismo billete para comparar mejora real."
  }
];

function buildWhatsAppUrl() {
  const phone = "59162512508";
  const message = "Necesito tu ayuda NumiCheck!";
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

function Stepper({
  steps,
  currentIndex,
  onChange
}: {
  steps: GuideStep[];
  currentIndex: number;
  onChange: (index: number) => void;
}) {
  const step = steps[currentIndex] ?? steps[0];
  const isFirst = currentIndex <= 0;
  const isLast = currentIndex >= steps.length - 1;

  return (
    <section className="help-stepper">
      <p className="help-step-kicker">{`Paso ${currentIndex + 1} de ${steps.length}`}</p>
      <h3>{step.title}</h3>
      <p>{step.body}</p>
      <div className="help-step-actions">
        <button type="button" className="menu-toggle" onClick={() => onChange(Math.max(0, currentIndex - 1))} disabled={isFirst}>
          Anterior
        </button>
        <button
          type="button"
          className="auth-button"
          onClick={() => onChange(isLast ? 0 : currentIndex + 1)}
        >
          {isLast ? "Reiniciar" : "Siguiente"}
        </button>
      </div>
    </section>
  );
}

export function HelpPage() {
  const { loading, user } = useAuth();
  const [hydrating, setHydrating] = useState(true);
  const [openSection, setOpenSection] = useState<SectionKey | null>("scan");
  const [scanStep, setScanStep] = useState(0);
  const [tuningStep, setTuningStep] = useState(0);
  const whatsappUrl = useMemo(() => buildWhatsAppUrl(), []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setHydrating(false);
    }, 360);

    return () => window.clearTimeout(timer);
  }, []);

  const loadingState = loading || hydrating;

  const toggleSection = (key: SectionKey) => {
    setOpenSection((prev) => (prev === key ? null : key));
  };

  return (
    <main className="public-page">
      <section className="public-shell">
        <header className="public-header">
          <HamburgerMenu />
          <PublicBrand loading={loading} user={user} />
        </header>
        <BackHomeButton loading={loading} />

        <section className="help-shell">
          {loadingState ? (
            <article className="help-card help-card--skeleton" aria-hidden="true">
              <div className="help-title-skeleton skeleton" />
              <div className="help-row-skeleton skeleton" />
              <div className="help-row-skeleton skeleton" />
              <div className="help-row-skeleton skeleton" />
            </article>
          ) : (
            <article className="help-card">
              <h1 className="help-title">Centro de ayuda</h1>
              <p className="help-note">Guia dinamica por pasos para escaneo, tuning y soporte.</p>

              <section className="help-accordion">
                <button
                  type="button"
                  className={`help-toggle ${openSection === "scan" ? "help-toggle--open" : ""}`}
                  onClick={() => toggleSection("scan")}
                  aria-expanded={openSection === "scan"}
                >
                  1. Como escanear
                </button>
                {openSection === "scan" ? (
                  <Stepper steps={SCAN_STEPS} currentIndex={scanStep} onChange={setScanStep} />
                ) : null}
              </section>

              <section className="help-accordion">
                <button
                  type="button"
                  className={`help-toggle ${openSection === "tuning" ? "help-toggle--open" : ""}`}
                  onClick={() => toggleSection("tuning")}
                  aria-expanded={openSection === "tuning"}
                >
                  2. Como configurar mi tuning de escaner
                </button>
                {openSection === "tuning" ? (
                  <Stepper steps={TUNING_STEPS} currentIndex={tuningStep} onChange={setTuningStep} />
                ) : null}
              </section>

              <section className="help-accordion">
                <button
                  type="button"
                  className={`help-toggle ${openSection === "contact" ? "help-toggle--open" : ""}`}
                  onClick={() => toggleSection("contact")}
                  aria-expanded={openSection === "contact"}
                >
                  3. Contactanos
                </button>
                {openSection === "contact" ? (
                  <section className="help-stepper">
                    <h3>Estamos listos para ayudarte</h3>
                    <p>
                      Si presentas algun problema, reclamo o duda sobre verificaciones, escaneo o configuracion,
                      nuestro equipo puede ayudarte paso a paso. Escríbenos y te guiaremos con una respuesta clara y
                      rapida para que sigas operando sin fricciones.
                    </p>
                    <div className="help-step-actions">
                      <a
                        href={whatsappUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="auth-button help-contact-button"
                      >
                        Escribir por WhatsApp
                      </a>
                    </div>
                  </section>
                ) : null}
              </section>
            </article>
          )}
        </section>
      </section>
    </main>
  );
}
