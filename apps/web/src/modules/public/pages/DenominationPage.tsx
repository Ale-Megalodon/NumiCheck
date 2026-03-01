import { Navigate, useParams } from "react-router-dom";
import { HamburgerMenu } from "../components/HamburgerMenu";
import { BANKNOTE_OPTIONS } from "../constants/banknotes";

export function DenominationPage() {
  const { denomination } = useParams<{ denomination: string }>();
  const selected = BANKNOTE_OPTIONS.find((item) => item.denomination === denomination);

  if (!selected) {
    return <Navigate to="/" replace />;
  }

  return (
    <main className="public-page">
      <section className="public-shell">
        <header className="public-header">
          <HamburgerMenu />
        </header>

        <section className="denomination-placeholder">
          <h1>{`${selected.denomination} bs`}</h1>
        </section>
      </section>
    </main>
  );
}
