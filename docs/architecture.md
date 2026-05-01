# Architecture & Build System

> Tech stack, build configuration, project structure, provider hierarchy, and routing.

**Status:** Active
**Last Updated:** 2026-03-22
**Related Docs:** [OVERVIEW.md](./OVERVIEW.md) | [state-management.md](./state-management.md) | [ui-components.md](./ui-components.md)

---

## Overview

IntegrateAPI CRM is a single-page application (SPA) backed by Supabase. It is built with React 18, TypeScript, and Vite, using shadcn/ui for its component library and Tailwind CSS for styling. CRM data is fetched from and persisted to Supabase via React Query hooks.

---

## File Map

| File | Purpose |
|------|---------|
| `package.json` | Dependencies, scripts, project metadata |
| `vite.config.ts` | Vite dev server + build configuration |
| `tailwind.config.ts` | Tailwind CSS customization (colors, animations, sidebar theme) |
| `components.json` | shadcn/ui CLI configuration |
| `tsconfig.json` | Base TypeScript config |
| `tsconfig.app.json` | App-specific TypeScript config (extends base) |
| `tsconfig.node.json` | Node/build TypeScript config (extends base) |
| `postcss.config.js` | PostCSS plugins (Tailwind + Autoprefixer) |
| `eslint.config.js` | ESLint config (React hooks + refresh plugins) |
| `src/main.tsx` | Application entry point — mounts `<App />` to `#root` |
| `src/App.tsx` | Root component — provider stack, routing, auth gating |
| `src/index.css` | Global styles, CSS custom properties (design tokens) |
| `src/App.css` | Unused Vite template CSS (candidate for removal) |
| `src/lib/utils.ts` | `cn()` utility — clsx + tailwind-merge |
| `src/lib/supabase.ts` | Supabase client singleton |
| `src/lib/transforms.ts` | snake_case ↔ camelCase transform utilities |
| `src/lib/api/*.ts` | Typed database query functions (8 files) |
| `src/types/database.ts` | Auto-generated Supabase TypeScript types |
| `.env` | Environment variables (Supabase URL + anon key) |
| `.env.example` | Template for environment variables |
| `src/pages/Index.tsx` | Placeholder index page (unused — Dashboard serves as `/`) |
| `src/pages/NotFound.tsx` | 404 page with "Return to Home" link |
| `index.html` | HTML shell with `#root` mount point |

---

## Detailed Behavior

### Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | React | 18.3.x |
| Language | TypeScript | 5.8.x |
| Bundler | Vite | 5.4.x (SWC compiler) |
| Styling | Tailwind CSS | 3.4.x |
| UI Library | shadcn/ui | Radix UI primitives |
| Routing | React Router | 6.30.x |
| State | React Context API | Built-in |
| Server State | @tanstack/react-query | 5.83.x (actively used) |
| Database | Supabase (PostgreSQL) | Managed |
| Edge Functions | Supabase (Deno) | Managed |
| Auth | Supabase Auth | Built-in |
| Charts | Recharts | 2.15.x |
| Forms | react-hook-form + zod | Available, lightly used |
| Notifications | Sonner + shadcn Toaster | Dual system |
| Icons | Lucide React | 0.462.x |
| Testing | Vitest + Testing Library + Playwright | Minimal coverage |

### Vite Configuration

```typescript
{
  server: {
    host: "::",        // Listen on all network interfaces
    port: 8080,        // Dev server port
    hmr: { overlay: false }  // No HMR error overlay
  },
  plugins: [react()],
  resolve: {
    alias: { "@": "./src" }  // Path alias: @/ → src/
  }
}
```

### Tailwind Configuration

- **Dark mode:** Class-based (`.dark` on root element)
- **Content scan:** `./src/**/*.{ts,tsx}`
- **Custom colors:** All derived from CSS variables in HSL format
- **Sidebar colors:** Separate color scheme (dark sidebar, light content)
- **Animations:** `accordion-down`, `accordion-up` for Radix accordion

### Provider Hierarchy

The app wraps all components in a provider stack. Order matters — inner providers can access outer ones.

```
QueryClientProvider          ← React Query (actively used for all CRM data)
  └─ TooltipProvider         ← Global tooltip context
      ├─ Toaster             ← shadcn toast notifications
      ├─ Sonner              ← Sonner toast notifications
      └─ AuthProvider        ← Authentication state
          └─ BrowserRouter   ← React Router
              └─ AuthGate    ← Conditional rendering based on auth
                  └─ Routes  ← Page routing
                      └─ AppLayout  ← Sidebar + header + content
                          └─ Page   ← Individual page component
```

Edge Functions (in `supabase/functions/`) run server-side Deno processes outside this provider stack. They are invoked directly from hooks or API layer code via the Supabase client and provide server-side compute — for example, `campaign-ai` proxies LLM requests to OpenRouter so API keys are never exposed to the browser, `send-email` dispatches outbound email via Resend, and `email-events` receives Resend webhooks to record bounce/open/click tracking.

### Auth Gating

`AuthGate` (in `App.tsx`) checks `loading` first, then `user`:
- **Loading:** Renders a branded spinner while Supabase restores any existing session (prevents flash of login page on refresh)
- **No user (loading complete):** Renders `<LoginPage />` (no routing — single component)
- **Has user:** Renders routes directly inside `<AppLayout />` — no `CRMProvider` wrapper needed (React Query hooks are available app-wide via `QueryClientProvider`)

### Route Definitions

All authenticated routes are children of `<AppLayout />` (which provides sidebar + header):

```typescript
<Route element={<AppLayout />}>
  <Route path="/" element={<DashboardPage />} />
  <Route path="/leads" element={<LeadsPage />} />
  <Route path="/leads/:id" element={<LeadDetailPage />} />
  <Route path="/generator" element={<LeadGeneratorPage />} />
  <Route path="/outreach" element={<OutreachPage />} />
  <Route path="/pipeline" element={<PipelinePage />} />
  <Route path="/settings" element={<SettingsPage />} />
</Route>
<Route path="*" element={<NotFound />} />
```

### CSS Architecture

**Design tokens** are defined as CSS custom properties in `src/index.css`:
- Root `:root` contains light mode values
- `.dark` class overrides for dark mode
- All colors use HSL format: `H S% L%` (no `hsl()` wrapper — Tailwind adds it)
- Sidebar has its own color namespace: `--sidebar-background`, `--sidebar-foreground`, etc.

**Key color variables:**
- `--primary`: `217.2 91.2% 59.8%` (blue)
- `--destructive`: `0 72% 51%` (red)
- `--sidebar-background`: `220 20% 12%` (dark navy)

### NPM Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `vite` | Start dev server on port 8080 |
| `build` | `vite build` | Production build |
| `build:dev` | `vite build --mode development` | Dev build with source maps |
| `preview` | `vite preview` | Preview production build |
| `lint` | `eslint .` | Run linting |
| `test` | `vitest run` | Run tests once |
| `test:watch` | `vitest` | Run tests in watch mode |

> Edge Functions are not part of the Vite build. They live in `supabase/functions/` and are deployed independently via `npx supabase functions deploy <function-name>`.

---

## Known Limitations & TODOs

- `App.css` contains unused Vite boilerplate — can be removed
- `Index.tsx` is an unused placeholder page — Dashboard is the root route at `/`
- No CI/CD configuration
- No Docker/containerization
- Minimal test coverage (single example test)

---

## Future Considerations

- Add protected route middleware that checks `isAdmin` for admin-only pages
- When adding SSR/SSG: may need to migrate from Vite SPA to Next.js or Remix

---

## Changelog

| Date | Change | Files Affected |
|------|--------|----------------|
| 2026-03-22 | Initial documentation created | — |
| 2026-03-22 | Added Supabase to tech stack, env vars, API layer | `supabase.ts`, `transforms.ts`, `api/*.ts`, `.env` |
| 2026-03-22 | AuthGate updated with loading state for session restoration | `App.tsx` |
| 2026-03-23 | CRMProvider removed from App.tsx, React Query now actively used | `App.tsx` |
| 2026-03-23 | Added Supabase Edge Functions (campaign-ai) for server-side LLM proxy | `supabase/functions/` |
| 2026-03-23 | Added send-email and email-events Edge Functions for Resend integration | `supabase/functions/` |
