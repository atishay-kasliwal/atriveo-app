import { sourceLabel, type Person, type Source } from './network';

/**
 * How a source came to you, independent of its name or the people in it: straight from you, through another source (a separate Randstad
 * met through All Things Open), or through a person (NKHS, introduced by Chani). The value is a source id, "p:" and a person id, or "".
 */
export default function NetworkSourceContext({ sources, people, parentSourceId, onParent, context, onContext, excludeId, prefix }: {
  sources: Source[]; people: Person[]; parentSourceId: string; onParent: (id: string) => void; context: string; onContext: (value: string) => void; excludeId?: string; prefix: string;
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
  // Someone who belongs to this source cannot be the one who introduced it.
  const introducers = people.filter((p) => !excludeId || p.sourceId !== excludeId);
  return <>
    <label className="nw-f"><span>Introduced through</span><select id={`${prefix}-parent`} value={parentSourceId} onChange={(e) => onParent(e.target.value)}>
      <option value="">Nobody — a direct connection</option>
      {introducers.length > 0 && <optgroup label="A person">{introducers.map((p) => <option key={p.id} value={`p:${p.id}`}>{p.name}</option>)}</optgroup>}
      {options.length > 0 && <optgroup label="Another source">{options.map((source) => <option key={source.id} value={source.id}>{sourceLabel(source, sources, people)}</option>)}</optgroup>}
    </select><small>A person: NKHS, introduced by Chani. Its own people still belong to NKHS, not to Chani. A source: a separate Randstad met through All Things Open.</small></label>
    <label className="nw-f"><span>Context / when you met</span><input id={`${prefix}-context`} value={context} onChange={(e) => onContext(e.target.value)} placeholder="Reached out last year, met at the event…" maxLength={100} /><small>The same name can have separate records in different contexts.</small></label>
  </>;
}
