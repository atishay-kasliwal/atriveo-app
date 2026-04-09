import { SignJWT } from "jose";

interface Env {
  atriveo_auth: D1Database;
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
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { email, password } = (await request.json()) as LoginBody;

    if (!email || !password) {
      return Response.json({ error: "Email and password required" }, { status: 400 });
    }

    const passwordHash = await hashPassword(password);

    const user = await env.atriveo_auth
      .prepare("SELECT email, name FROM users WHERE email = ? AND password_hash = ?")
      .bind(email.toLowerCase().trim(), passwordHash)
      .first<{ email: string; name: string }>();

    if (!user) {
      return Response.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const secret = new TextEncoder().encode(env.JWT_SECRET);
    const token = await new SignJWT({ email: user.email, name: user.name })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(secret);

    return new Response(JSON.stringify({ ok: true, name: user.name }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": `atriveo_token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`,
      },
    });
  } catch {
    return Response.json({ error: "Server error" }, { status: 500 });
  }
};
