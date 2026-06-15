import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config();

const DB_NAME = "job_pipeline";

let sharedClient = null;

export function getMongoUri() {
  const uri = process.env.MONGO_URI?.trim();
  if (!uri) throw new Error("MONGO_URI is not set");
  return uri;
}

export async function connectMongo({ appName = "AtriveoApp" } = {}) {
  if (sharedClient) return sharedClient;
  sharedClient = new MongoClient(getMongoUri(), { appName });
  await sharedClient.connect();
  return sharedClient;
}

export function getDb(client) {
  return client.db(DB_NAME);
}

export async function withMongo(fn, { appName = "AtriveoApp" } = {}) {
  const client = await connectMongo({ appName });
  try {
    return await fn(getDb(client), client);
  } finally {
    // keep connection open for worker loops; caller closes via closeMongo()
  }
}

export async function closeMongo() {
  if (sharedClient) {
    await sharedClient.close();
    sharedClient = null;
  }
}
