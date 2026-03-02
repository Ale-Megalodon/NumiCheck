import { HamburgerMenu } from "../components/HamburgerMenu";
import { useAuth } from "../../../app/providers/AuthProvider";
import { PublicBrand } from "../components/PublicBrand";

type FeaturePlaceholderPageProps = {
  title: string;
};

export function FeaturePlaceholderPage({ title }: FeaturePlaceholderPageProps) {
  const { loading, user } = useAuth();

  return (
    <main className="public-page">
      <section className="public-shell">
        <header className="public-header">
          <HamburgerMenu />
          <PublicBrand loading={loading} user={user} />
        </header>

        <section className="denomination-placeholder">
          {loading ? <div className="denomination-skeleton skeleton" aria-hidden="true" /> : <h1>{title}</h1>}
        </section>
      </section>
    </main>
  );
}
