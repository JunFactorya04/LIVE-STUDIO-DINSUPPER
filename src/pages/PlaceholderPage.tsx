import { EmptyState } from "../components/States";
import { useI18n } from "../i18n";

// Pages whose feature is delivered in a later phase. They say so plainly instead of faking data.
export function PlaceholderPage({ phase }: { phase: number }) {
  const { t, fmt } = useI18n();
  return (
    <div className="page page--no-inspector">
      <section className="box">
        <EmptyState title={t.phase.title} hint={fmt(t.phase.hint, { n: phase })} />
      </section>
    </div>
  );
}
