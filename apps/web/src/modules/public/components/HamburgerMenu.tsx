import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../app/providers/AuthProvider";

export function HamburgerMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showExitHint, setShowExitHint] = useState(false);
  const [armedUntil, setArmedUntil] = useState(0);
  const hintTimerRef = useRef<number | null>(null);
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

  const handleExit = () => {
    const now = Date.now();
    setMenuOpen(false);

    if (armedUntil > now) {
      setShowExitHint(false);
      setArmedUntil(0);

      if (hintTimerRef.current) {
        window.clearTimeout(hintTimerRef.current);
        hintTimerRef.current = null;
      }

      if (window.history.length > 1) {
        navigate(-1);
      } else {
        navigate("/", { replace: true });
      }
      return;
    }

    setShowExitHint(true);
    setArmedUntil(now + 2200);

    if (hintTimerRef.current) {
      window.clearTimeout(hintTimerRef.current);
    }

    hintTimerRef.current = window.setTimeout(() => {
      setShowExitHint(false);
      setArmedUntil(0);
      hintTimerRef.current = null;
    }, 2200);
  };

  useEffect(
    () => () => {
      if (hintTimerRef.current) {
        window.clearTimeout(hintTimerRef.current);
      }
    },
    []
  );

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
              <button type="button" className="home-menu-item" onClick={handleExit}>
                Salir
              </button>
            </>
          ) : (
            <>
              <button type="button" className="home-menu-item" onClick={() => goTo("/login")}>
                Iniciar sesion
              </button>
              <button type="button" className="home-menu-item" onClick={handleExit}>
                Salir
              </button>
            </>
          )}
        </nav>
      ) : null}

      {showExitHint ? <div className="exit-hint-toast">Pulsa dos veces para salir</div> : null}
    </div>
  );
}
