# Next Step Timesheets

Coach timesheet / payroll app. Refine + React + Vite, Ant Design, Supabase. See [CLAUDE.md](./CLAUDE.md) for full project context.

## Local setup

```
npm install
cp .env.example .env.local   # fill in your Supabase project URL + anon key
npm run dev
```

## Deployment

Pushes to `main` build and publish automatically to GitHub Pages via `.github/workflows/deploy.yml`. That workflow needs two repository secrets set under **Settings → Secrets and variables → Actions**:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
