# Atriveo App

A full-stack job search platform that automatically captures job applications through a Chrome extension, tracks them in a centralized dashboard, and provides AI-powered insights to streamline your job search.

## Features

- **Chrome Extension** — One-click job capture from LinkedIn, Indeed, and other job boards (5.0 stars on the Chrome Web Store)
- **Application Dashboard** — Centralized tracking for all applications with status, company, and timeline
- **AI-Powered Search** — RAG-based contextual recommendations and search across your pipeline
- **Analytics** — Visual insights into application pipeline and response rates

## Tech Stack

**Frontend:** React, TypeScript, Vite, TailwindCSS
**Backend:** Python, FastAPI, PostgreSQL
**AI:** LangChain, RAG pipeline
**Infrastructure:** Docker, Cloudflare Pages, Cloudflare Workers

## Highlights

- 100+ active users, 2K+ daily queries, 99.9% uptime
- Open source Chrome extension with 5.0 stars on the Chrome Web Store
- Multi-service architecture with serverless edge deployment

## Getting Started

```bash
npm install
npm run dev
```

To refresh full job-description buckets used by bulk copy:

```bash
npm run export:descriptions
```

This reads `MONGO_URI` locally and writes `public/job_descriptions/*.json`.

Set these GitHub repository secrets for deployment:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

Set these Cloudflare Pages environment variables for tracker sync:

- `JWT_SECRET` — random 32+ char string for signing sessions
- `TRACKER_API_URL` — Atriveo tracker API base URL; the app posts to `/integrations/atriveo/applications`
- `TRACKER_API_TOKEN` — Bearer token for the tracker integration; keep this only in Cloudflare server env/secrets

## License

MIT
