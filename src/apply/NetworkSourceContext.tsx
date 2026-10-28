import { sourceLabel, type Source } from './network';

/** Source provenance is independent of its employer name or the people in it. */
export default function NetworkSourceContext({ sources, parentSourceId, onParent, context, onContext, excludeId, prefix }: {
  sources: Source[]; parentSourceId: string; onParent: (id: string) => void; context: string; onContext: (value: string) => void; excludeId?: string; prefix: string;
}) {
  const options = sources.filter((source) => {
    let current: Source | undefined = source;
    const visited = new Set<string>();
    while (current) {
      if (current.id === excludeId || visited.has(current.id)) return false;
      visited.add(current.id); current = sources.find((candidate) => candidate.id === current?.parentSourceId);
    }
    return true;
  });
  return <>
    <label className="nw-f"><span>Introduced through another source</span><select id={`${prefix}-parent`} value={parentSourceId} onChange={(e) => onParent(e.target.value)}><option value="">None — a direct connection</option>{options.map((source) => <option key={source.id} value={source.id}>{sourceLabel(source, sources)}</option>)}</select><small>For example: a separate Randstad source met through All Things Open.</small></label>
    <label className="nw-f"><span>Context / when you met</span><input id={`${prefix}-context`} value={context} onChange={(e) => onContext(e.target.value)} placeholder="Reached out last year, met at the event…" maxLength={100} /><small>The same name can have separate records in different contexts.</small></label>
  </>;
}
