import { SignJWT } from "jose";
import { emailAllowed, NOT_ALLOWED_MESSAGE, type AdminEnv } from "../../_lib/admin";
import { hashPassword, isLegacyHash, verifyPassword } from "../../_lib/password";
import { clearFailures, loginBlocked, recordFailure, WINDOW_MINUTES } from "../../_lib/loginLimit";

interface Env extends AdminEnv {
  atriveo_auth: D1Database;
  JWT_SECRET: string;
}

interface LoginBody {
  email: string;
  password: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { email, password } = (await request.json()) as LoginBody;

    if (!email || !password) {
      return Response.json({ error: "Email and password required" }, { status: 400 });
    }

    if (!emailAllowed(env, email)) {
      return Response.json({ error: NOT_ALLOWED_MESSAGE }, { status: 403 });
    }

    const key = email.toLowerCase().trim();
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (await loginBlocked(env.atriveo_auth, key, ip)) {
      return Response.json({ error: `Too many sign-in attempts. Try again in ${WINDOW_MINUTES} minutes.` }, { status: 429 });
    }

    const row = await env.atriveo_auth
      .prepare("SELECT email, name, password_hash FROM users WHERE email = ?")
      .bind(key)
      .first<{ email: string; name: string; password_hash: string | null }>();

    if (!row || !(await verifyPassword(password, row.password_hash))) {
      await recordFailure(env.atriveo_auth, key, ip);
      return Response.json({ error: "Invalid email or password" }, { status: 401 });
    }
    await clearFailures(env.atriveo_auth, key);
    // An account still on the old unsalted hash moves to PBKDF2 now that the password is known.
    if (isLegacyHash(row.password_hash)) {
      await env.atriveo_auth.prepare("UPDATE users SET password_hash = ? WHERE email = ?").bind(await hashPassword(password), key).run();
    }
    const user = { email: row.email, name: row.name };

    const secret = new TextEncoder().encode(env.JWT_SECRET);
    const token = await new SignJWT({ email: user.email, name: user.name })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(secret);

    return new Response(JSON.stringify({ ok: true, name: user.name, token }), {
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
