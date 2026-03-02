import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../app/providers/AuthProvider";

export function HamburgerMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const { user, loading, logout } = useAuth();

  const goTo = (path: string) => {
    setMenuOpen(false);
    navigate(path);
  };

  const handleLogout = async () => {
    await logout();
    setMenuOpen(false);
    navigate("/", { replace: true });
  };

  if (loading) {
    return <div className="menu-toggle menu-toggle--icon menu-toggle--skeleton skeleton" aria-hidden="true" />;
  }

  return (
    <div className="public-menu-wrap">
      <button
        type="button"
        className="menu-toggle menu-toggle--icon"
        onClick={() => setMenuOpen((prev) => !prev)}
        aria-expanded={menuOpen}
        aria-controls="public-menu"
        aria-label="Abrir menu"
      >
        <span />
        <span />
        <span />
      </button>

      {menuOpen ? (
        <nav id="public-menu" className="home-menu public-menu">
          {user ? (
            <>
              <button type="button" className="home-menu-item" onClick={() => goTo("/perfil")}>
                Perfil
              </button>
              <button type="button" className="home-menu-item" onClick={() => goTo("/historial")}>
                Historial
              </button>
              <button type="button" className="home-menu-item" onClick={() => goTo("/configuracion")}>
                Configuracion
              </button>
              <button type="button" className="home-menu-item" onClick={() => goTo("/ayuda")}>
                Ayuda
              </button>
              <button type="button" className="home-menu-item home-menu-item--danger" onClick={handleLogout}>
                Cerrar sesion
              </button>
            </>
          ) : (
            <>
              <button type="button" className="home-menu-item" onClick={() => goTo("/login")}>
                Iniciar sesion
              </button>
            </>
          )}
        </nav>
      ) : null}
    </div>
  );
}
