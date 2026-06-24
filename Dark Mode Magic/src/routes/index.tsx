import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Atriveo — Job Feed" },
      { name: "description", content: "Sign in to Atriveo Job Feed." },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@500;600&display=swap",
      },
    ],
  }),
  component: SignIn,
});

function SignIn() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("katishay@gmail.com");
  const [password, setPassword] = useState("password1234");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-2xl">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary font-bold text-primary-foreground">
            A
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-foreground">Atriveo</h1>
            <p className="text-xs text-muted-foreground">Job Feed</p>
          </div>
        </div>

        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            navigate({ to: "/feed" });
          }}
        >
          <div className="space-y-2">
            <label
              htmlFor="email"
              className="font-mono text-[11px] font-medium tracking-[0.18em] text-muted-foreground"
            >
              EMAIL
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-border bg-input px-3.5 py-2.5 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/40"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="password"
              className="font-mono text-[11px] font-medium tracking-[0.18em] text-muted-foreground"
            >
              PASSWORD
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-border bg-input px-3.5 py-2.5 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/40"
            />
          </div>

          <button
            type="submit"
            className="group flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:brightness-110 active:brightness-95"
          >
            Sign in
            <span className="transition-transform group-hover:translate-x-0.5">→</span>
          </button>
        </form>
      </div>
    </div>
  );
}
