import { useState } from "react";
import { useNavigate } from "react-router-dom";

export function HamburgerMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();

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
          <button
            type="button"
            className="home-menu-item"
            onClick={() => {
              setMenuOpen(false);
              navigate("/login");
            }}
          >
            Iniciar sesion
          </button>
        </nav>
      ) : null}
    </div>
  );
}
