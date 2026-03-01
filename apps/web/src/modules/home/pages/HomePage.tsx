import { useState } from "react";
import { useAuth } from "../../../app/providers/AuthProvider";
import { BrandWordmark } from "../../../shared/components/ui/BrandWordmark";

export function HomePage() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <main className="home-page">
      <section className="home-shell">
        <header className="home-header">
          <BrandWordmark className="home-title-logo" weight="semibold" />
          <div className="home-menu-wrap">
            <button
              type="button"
              className="menu-toggle"
              onClick={() => setMenuOpen((prev) => !prev)}
              aria-expanded={menuOpen}
              aria-controls="home-menu"
            >
              Menu
            </button>
            {menuOpen ? (
              <nav id="home-menu" className="home-menu">
                <button type="button" className="home-menu-item">
                  Historial
                </button>
                <button type="button" className="home-menu-item">
                  Ayuda
                </button>
                <button type="button" className="home-menu-item">
                  Perfil
                </button>
                <button type="button" className="home-menu-item">
                  Configuracion
                </button>
                <button type="button" className="home-menu-item home-menu-item--danger" onClick={logout}>
                  Cerrar sesion
                </button>
              </nav>
            ) : null}
          </div>
        </header>

        <section className="home-card">
          <p className="home-user">Sesion: {user?.email ?? "sin correo"}</p>
          <h2>Valida tu billete por numero de serie</h2>
          <p>Selecciona un metodo para comenzar.</p>
          <div className="home-actions">
            <button type="button" className="auth-button home-main-action">
              Escanear billete
            </button>
            <button type="button" className="auth-button home-main-action">
              Ingresar manualmente
            </button>
          </div>
        </section>
      </section>
    </main>
  );
}
