import { SignJWT } from "jose";
import { emailAllowed, NOT_ALLOWED_MESSAGE, type AdminEnv } from "../../_lib/admin";
import { hashPassword } from "../../_lib/password";

interface Env extends AdminEnv {
  atriveo_auth: D1Database;
  JWT_SECRET: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { email, password, name } = (await request.json()) as {
      email?: string;
      password?: string;
      name?: string;
    };

    if (!email || !password || !name) {
      return Response.json({ error: "Name, email and password are required" }, { status: 400 });
    }
    // On the admin site only allowlisted emails can create an account.
    if (!emailAllowed(env, email)) {
      return Response.json({ error: NOT_ALLOWED_MESSAGE }, { status: 403 });
    }
    if (password.length < 8) {
      return Response.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const existing = await env.atriveo_auth
      .prepare("SELECT email FROM users WHERE email = ?")
      .bind(email.toLowerCase().trim())
      .first();

    if (existing) {
      return Response.json({ error: "An account with that email already exists" }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);

    await env.atriveo_auth
      .prepare("INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, datetime('now'))")
      .bind(email.toLowerCase().trim(), name.trim(), passwordHash)
      .run();

    const secret = new TextEncoder().encode(env.JWT_SECRET);
    const token = await new SignJWT({
      email: email.toLowerCase().trim(),
      name: name.trim(),
      avatar: null,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(secret);

    return new Response(JSON.stringify({ ok: true, name: name.trim() }), {
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
