import { jwtVerify } from "jose";

interface Env {
  JWT_SECRET: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const cookie = request.headers.get("Cookie") || "";
  const token = cookie.match(/atriveo_token=([^;]+)/)?.[1];

  if (!token) {
    return Response.json({ user: null }, { status: 401 });
  }

  try {
    const secret = new TextEncoder().encode(env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    return Response.json({ user: { email: payload.email, name: payload.name } });
  } catch {
    return Response.json({ user: null }, { status: 401 });
  }
};
