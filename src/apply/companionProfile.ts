import { getJson } from "./engine";
import { checkCompanion, sendToExtension } from "./companionLink";

let last = 0;
/**
 * Hands the extension the details you share on every application (name, email, phone, links) so its panel can offer them on any page,
 * with no application open. Runs when a console page loads or comes back into view, at most every ten minutes.
 */
export async function syncProfileToExtension(): Promise<void> {
  if (Date.now() - last < 10 * 60_000) return;
  last = Date.now();
  try {
    if (!(await checkCompanion({ attempts: 2, timeoutMs: 2000 }))) { last = 0; return; }
    const { fields } = await getJson<{ fields: unknown[] }>("/applications/profile-details");
    await sendToExtension("PROFILE", 5000, { fields });
  } catch { last = 0; /* try again on the next load */ }
}
