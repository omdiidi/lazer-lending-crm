# Plan: Remove Lovable Branding, Replace with Connect CRM

## Goal

Remove all Lovable marketing/branding from the site and replace with Connect CRM branding. Favicon, title, meta tags, OG images, dev dependencies, placeholder files.

## Why

- Browser tab shows "Lovable App" and the Lovable logo favicon
- Meta/OG tags link to lovable.dev images
- README says "Welcome to your Lovable project"
- Dev dependency `lovable-tagger` and `.lovable/` directory are scaffold artifacts

## Files Being Changed

```
index.html                          ← MODIFIED (title, meta, OG tags, favicon link)
public/favicon.ico                  ← REPLACED (new Connect CRM favicon)
public/favicon.svg                  ← NEW (SVG favicon for modern browsers)
README.md                           ← MODIFIED (remove Lovable header)
vite.config.ts                      ← MODIFIED (remove lovable-tagger import)
src/pages/Index.tsx                  ← MODIFIED (remove lovable placeholder)
CODEBASE_ANALYSIS.md                ← MODIFIED (remove Lovable mention)
docs/architecture.md                ← MODIFIED (remove Lovable mentions)
.lovable/                           ← DELETE (entire directory)
```

## Tasks

### Task 1: Create new favicon

Generate a simple SVG favicon — the letters "CC" (Connect CRM) in a rounded square, using the app's primary color (blue-600 / #2563eb). Save as `public/favicon.svg`.

Also generate a simple .ico from the same design or use a minimal placeholder .ico to replace the Lovable one at `public/favicon.ico`.

### Task 2: MODIFY `index.html`

Replace ALL Lovable content:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="icon" type="image/x-icon" href="/favicon.ico" />
    <title>Connect CRM</title>
    <meta name="description" content="Sales CRM for lead management, email outreach, and campaign automation" />
    <meta name="author" content="IntegrateAPI" />

    <meta property="og:title" content="Connect CRM" />
    <meta property="og:description" content="Sales CRM for lead management, email outreach, and campaign automation" />
    <meta property="og:type" content="website" />

    <meta name="twitter:card" content="summary_large_image" />
  </head>

  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Key changes:
- Title: "Connect CRM"
- Description: actual product description
- Author: "IntegrateAPI"
- Remove Lovable OG image URLs (no replacement needed — just omit)
- Remove `@Lovable` Twitter handle
- Add favicon `<link>` tags for both SVG and ICO

### Task 3: MODIFY `vite.config.ts`

Remove the `lovable-tagger` import and its usage in the plugins array:
- Remove: `import { componentTagger } from "lovable-tagger";`
- Remove: `componentTagger()` from the plugins array (it's in the `mode === 'development'` conditional)

### Task 4: MODIFY `src/pages/Index.tsx`

Remove the Lovable placeholder image (line 9):
```tsx
<img data-lovable-blank-page-placeholder="REMOVE_THIS" src="/placeholder.svg" alt="Your app will live here!" />
```
This page is unused (dashboard is at `/`) but clean it up. Replace with a simple redirect to `/` or just an empty fragment.

### Task 5: MODIFY `README.md`

Replace `# Welcome to your Lovable project` with `# Connect CRM`

### Task 6: MODIFY `CODEBASE_ANALYSIS.md`

Line 26: Remove or rewrite the Lovable origin mention.

### Task 7: MODIFY `docs/architecture.md`

- Line 79: Remove the Lovable comment from the vite config example
- Line 169: Remove the Lovable placeholder mention

### Task 8: DELETE `.lovable/` directory

```bash
rm -rf .lovable/
```

### Task 9: Remove `lovable-tagger` dependency

```bash
npm uninstall lovable-tagger
```

This updates `package.json` and `package-lock.json` automatically.

## Deprecated Code to Remove

- `lovable-tagger` npm package
- `.lovable/` directory
- All `lovable.dev` URL references
- `data-lovable-blank-page-placeholder` attribute

## Validation

```bash
npx tsc --noEmit
npm run build
```

## Confidence: 10/10
