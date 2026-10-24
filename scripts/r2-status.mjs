// Is R2 actually being used? Counts recent jobs whose resume was stored in R2, or failed to be, straight from Mongo.
//   npm run r2-status            (needs the Mongo tunnel / MONGO_URI in .env)
import { withMongo } from "./mongo-client.mjs";

await withMongo(async (db) => {
  const jobs = db.collection("jobs");
  const day = new Date(Date.now() - 86_400_000);
  const [stored, failed, built, newest] = await Promise.all([
    jobs.countDocuments({ "resume.object.key": { $type: "string" }, "resume.updated_at": { $gte: day.toISOString() } }),
    jobs.countDocuments({ "resume.object_error": { $type: "string" }, "resume.updated_at": { $gte: day.toISOString() } }),
    jobs.countDocuments({ "resume.status": "success", "resume.updated_at": { $gte: day.toISOString() } }),
    jobs.find({ "resume.object.key": { $type: "string" } }, { projection: { _id: 0, "resume.object.key": 1, "resume.updated_at": 1 } }).sort({ "resume.updated_at": -1 }).limit(1).toArray(),
  ]);
  const err = await jobs.find({ "resume.object_error": { $type: "string" } }, { projection: { _id: 0, "resume.object_error": 1 } }).sort({ "resume.updated_at": -1 }).limit(1).toArray();
  console.log(`Resumes finished in the last 24 h: ${built}`);
  console.log(`  stored in R2: ${stored}   failed to store: ${failed}`);
  if (newest[0]) console.log(`  newest stored: ${newest[0].resume.object.key.slice(0, 24)}…  at ${newest[0].resume.updated_at}`);
  if (err[0]) console.log(`  last storage error: ${err[0].resume.object_error}`);
  console.log(stored > 0 ? "R2 is working: new resumes are being stored." : built === 0 ? "No resume has finished since R2 was turned on: check again later." : "Resumes are finishing but none were stored: check the worker log and the settings.");
});
process.exit(0);
