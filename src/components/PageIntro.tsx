import type { ReactNode } from "react";

type PageStatTone = "blue" | "green" | "orange" | "purple" | "red" | "slate";

interface PageStat {
  label: string;
  value: ReactNode;
  tone?: PageStatTone;
}

interface PageIntroProps {
  kicker?: string;
  title: string;
  description: ReactNode;
  stats?: PageStat[];
  action?: ReactNode;
  compact?: boolean;
}

const toneClass: Record<PageStatTone, string> = {
  blue: "page-hero-stat-blue",
  green: "page-hero-stat-green",
  orange: "page-hero-stat-orange",
  purple: "page-hero-stat-purple",
  red: "page-hero-stat-red",
  slate: "page-hero-stat-slate",
};

export default function PageIntro({
  kicker,
  title,
  description,
  stats = [],
  action,
  compact = false,
}: PageIntroProps) {
  return (
    <section className={`page-hero${compact ? " page-hero-compact" : ""}`}>
      <div className="page-hero-copy">
        {kicker && <div className="page-hero-kicker">{kicker}</div>}
        <h1 className="page-hero-title">{title}</h1>
        <p className="page-hero-desc">{description}</p>
      </div>

      {(action || stats.length > 0) && (
        <div className="page-hero-aside">
          {action && <div className="page-hero-action">{action}</div>}
          {stats.length > 0 && (
            <div className="page-hero-stats">
              {stats.map((stat) => (
                <div key={stat.label} className={`page-hero-stat ${toneClass[stat.tone ?? "slate"]}`}>
                  <div className="page-hero-stat-label">{stat.label}</div>
                  <div className="page-hero-stat-value">{stat.value}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
