/**
 * Create a user in the atriveo_auth database.
 * Usage: npx tsx scripts/create-user.ts
 *
 * Requires MONGO_URI in environment or .env file.
 */
import { createHash } from "crypto";

async function main() {
  const { MongoClient } = await import("mongodb");
  const dotenv = await import("dotenv");
  dotenv.config();

  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI not set");

  const users = [
    { email: "katishay@gmail.com", name: "Atishay", password: process.env.USER1_PASSWORD || "" },
  ];

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("atriveo_auth");
  const col = db.collection("users");

  for (const user of users) {
    if (!user.password) {
      console.error(`No password set for ${user.email} — set USER1_PASSWORD env var`);
      continue;
    }
    const password_hash = createHash("sha256").update(user.password).digest("hex");
    await col.updateOne(
      { email: user.email },
      { $set: { email: user.email, name: user.name, password_hash, updated_at: new Date() } },
      { upsert: true }
    );
    console.log(`✓ Created/updated user: ${user.email}`);
  }

  await client.close();
  console.log("Done.");
}

main().catch(console.error);
