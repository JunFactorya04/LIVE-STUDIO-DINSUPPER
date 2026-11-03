import { useEffect, useMemo, useState } from "react";
import { NavIcon } from "../components/Icons";
import { useI18n } from "../i18n";
import { useLiveSession } from "../live/useLiveSession";
import type { PageId } from "../navigation";
import { createShipClient, type ShipClient, type ShipOrder } from "../ship/client";
import { requestScanMode } from "./ScanPage";

// The phone's start screen (sharing link): today's live orders at a glance, then a grid of
// tools, the scan-to-pay one first. Every number is counted from the app's own data.

const sameDay = (iso: string, d: Date) => {
  const x = new Date(iso);
  return (
    x.getFullYear() === d.getFullYear() &&
    x.getMonth() === d.getMonth() &&
    x.getDate() === d.getDate()
  );
};

export function HomePage({
  onNavigate,
  ship,
}: {
  onNavigate: (page: PageId) => void;
  ship?: ShipClient;
}) {
  const { t } = useI18n();
  const h = t.home;
  const s = useLiveSession();
  const [api] = useState(() => ship ?? createShipClient());
  const [orders, setOrders] = useState<ShipOrder[]>();

  useEffect(() => {
    if (!api.available) return;
    let live = true;
    api
      .orders()
      .then((o) => live && setOrders(o))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api]);

  const today = useMemo(() => {
    const now = new Date();
    const list = s.drafts.filter((d) => d.status !== "CANCELLED" && sameDay(d.createdAt, now));
    return {
      all: list.length,
      review: list.filter((d) => d.status === "DRAFT" || d.status === "NEEDS_REVIEW").length,
      confirmed: list.filter((d) => d.status === "CONFIRMED").length,
    };
  }, [s.drafts]);
  const toShip = orders?.filter((o) => !o.exported).length;
  const review = s.drafts.filter((d) => d.status === "NEEDS_REVIEW").length;
  const liveOn = s.status === "CONNECTED";

  const tools: { id: PageId; label: string; badge?: number | "dot"; go?: () => void }[] = [
    {
      id: "scan",
      label: h.scanPay,
      go: () => {
        requestScanMode("pay");
        onNavigate("scan");
      },
    },
    { id: "console", label: h.createLive, badge: liveOn ? "dot" : undefined },
    { id: "ship", label: t.nav.ship, badge: toShip || undefined },
    { id: "orders", label: t.nav.orders, badge: review || undefined },
    { id: "replies", label: t.nav.replies },
    { id: "report", label: t.nav.report },
    { id: "warehouse", label: t.nav.warehouse },
    { id: "flow", label: t.nav.flow },
    { id: "dashboard", label: t.nav.dashboard },
  ];

  return (
    <div className="page page--no-inspector home">
      <section className="home__today" aria-label={h.today}>
        <div className="home__today-head">
          <span>{h.today}</span>
          {liveOn && <span className="chip tone-red">{h.liveOn}</span>}
        </div>
        <strong className="home__big">{today.all}</strong>
        <div className="home__stats">
          <div className="home__stat tone-orange">
            <span>{h.review}</span>
            <strong>{today.review}</strong>
          </div>
          <div className="home__stat tone-green">
            <span>{h.confirmed}</span>
            <strong>{today.confirmed}</strong>
          </div>
          <div className="home__stat tone-blue">
            <span>{h.toShip}</span>
            <strong>{toShip ?? "—"}</strong>
          </div>
        </div>
      </section>

      <section aria-label={h.tools}>
        <h2 className="section-title home__title">{h.tools}</h2>
        <div className="home__grid">
          {tools.map((x, i) => (
            <button
              key={x.id + i}
              type="button"
              className={`home__tile${i === 0 ? " home__tile--primary" : ""}`}
              onClick={x.go ?? (() => onNavigate(x.id))}
            >
              <NavIcon id={x.id} size={28} />
              <span>{x.label}</span>
              {x.badge === "dot" ? (
                <i className="home__dot" aria-hidden="true" />
              ) : x.badge ? (
                <span className="home__badge">{x.badge}</span>
              ) : null}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
