import { HamburgerMenu } from "../components/HamburgerMenu";

type FeaturePlaceholderPageProps = {
  title: string;
};

export function FeaturePlaceholderPage({ title }: FeaturePlaceholderPageProps) {
  return (
    <main className="public-page">
      <section className="public-shell">
        <header className="public-header">
          <HamburgerMenu />
        </header>

        <section className="denomination-placeholder">
          <h1>{title}</h1>
        </section>
      </section>
    </main>
  );
}
