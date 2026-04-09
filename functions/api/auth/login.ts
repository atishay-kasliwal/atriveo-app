import { SignJWT } from "jose";

interface Env {
  MONGO_URI: string;
  JWT_SECRET: string;
}

interface LoginBody {
  email: string;
  password: string;
}

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function queryMongo(mongoUri: string, body: object): Promise<Response> {
  // Extract base URL for MongoDB Data API
  const url = mongoUri;
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { email, password } = (await request.json()) as LoginBody;

    if (!email || !password) {
      return Response.json({ error: "Email and password required" }, { status: 400 });
    }

    const passwordHash = await hashPassword(password);

    // Query MongoDB Data API
    const res = await fetch(
      `https://data.mongodb-api.com/app/data-api/endpoint/data/v1/action/findOne`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": env.MONGO_DATA_API_KEY,
        },
        body: JSON.stringify({
          dataSource: "AtriveoAirflow",
          database: "atriveo_auth",
          collection: "users",
          filter: { email: email.toLowerCase(), password_hash: passwordHash },
        }),
      }
    );

    const data = (await res.json()) as { document: { email: string; name: string } | null };

    if (!data.document) {
      return Response.json({ error: "Invalid credentials" }, { status: 401 });
    }

    // Sign JWT
    const secret = new TextEncoder().encode(env.JWT_SECRET);
    const token = await new SignJWT({
      email: data.document.email,
      name: data.document.name,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(secret);

    return new Response(JSON.stringify({ ok: true, name: data.document.name }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": `atriveo_token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`,
      },
    });
  } catch (e) {
    return Response.json({ error: "Server error" }, { status: 500 });
  }
};
