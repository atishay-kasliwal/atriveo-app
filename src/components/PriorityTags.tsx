import "./priority-tags.css";

// Why a job sits where it does in the application order (job-pipeline's priority tags),
// e.g. "Strong match" · "Raleigh" · "New grad". Shown on the job feed and the application console.

export default function PriorityTags({ tags, group }: { tags?: string[] | null; group?: number | null }) {
  if (!tags?.length) return null;
  return (
    <div className="priority-tags" title={group != null ? `Priority group ${group} (0 is first)` : undefined}>
      {tags.map((t) => (
        <span key={t} className={`priority-tag${t === "Strong match" ? " priority-tag--strong" : ""}`}>{t}</span>
      ))}
    </div>
  );
}
