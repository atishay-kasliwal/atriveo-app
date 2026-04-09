export const onRequestPost: PagesFunction = async () => {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": "atriveo_token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0",
    },
  });
};
