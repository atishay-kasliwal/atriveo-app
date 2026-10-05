import { getTailorServerBase } from "../utils/tailorServer";

// Discard from Today: the engine's discard_applications (marks them skipped, keeps their history; active
// approvals and anything with a submission attempt are protected and come back as errors).

async function request(body: object): Promise<Record<string, unknown>> {
  const res = await fetch(`${getTailorServerBase()}/applications/action`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "discard_applications", ...body }) });
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || !json.ok) throw new Error(json.error ?? "Couldn't discard");
  return json;
}

/** Discard these applications now (preview, then confirm exactly what the preview found). */
export async function discardNow(ids: string[]): Promise<{ discarded: string[]; errors: string[] }> {
  const { targets } = (await request({ operation: "preview", ids })) as { targets: Array<{ id: string; updatedAt: string }> };
  if (!targets.length) return { discarded: [], errors: ["Not eligible: active, submitted or already attempted applications are protected."] };
  const r = (await request({ operation: "confirm", targets: targets.map(({ id, updatedAt }) => ({ id, updatedAt })) })) as { discarded: Array<string | { id: string }>; errors: Array<{ error: string }> };
  return { discarded: r.discarded.map((d) => typeof d === "string" ? d : d.id), errors: r.errors.map((e) => e.error) };
}
