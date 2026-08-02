# CLAUDE.md

Guidance for AI assistants (and humans) working in this repository.

## Project overview

A minimal Next.js boilerplate scaffolded with `create-next-app`. It uses the
**App Router**, **React 19**, **Tailwind CSS v4**, and **TypeScript** in strict
mode. The repo is currently a clean starting point — the home page is the
default template page. Build features by adding routes and components under
`app/`.

## Tech stack

| Concern        | Choice                                              |
| -------------- | --------------------------------------------------- |
| Framework      | Next.js 16 (App Router)                             |
| UI library     | React 19 (`react` / `react-dom`)                    |
| Language       | TypeScript 5 (`strict: true`)                       |
| Styling        | Tailwind CSS v4 (via `@tailwindcss/postcss`)        |
| Linting        | ESLint 9 (flat config, `eslint-config-next`)        |
| Fonts          | `next/font` with Geist Sans & Geist Mono            |

## Commands

```bash
npm run dev      # Start the dev server (http://localhost:3000)
npm run build    # Production build
npm run start    # Serve the production build (run build first)
npm run lint     # Run ESLint
```

There is no test runner or formatter configured yet. There is no `typecheck`
script — type errors surface during `npm run build` (or via the editor /
`npx tsc --noEmit`).

## Project structure

```
app/                 # App Router root — routes, layouts, and global styles
  layout.tsx         # Root layout: <html>/<body>, font variables, metadata
  page.tsx           # Home route ("/") — currently the default template page
  globals.css        # Tailwind import + CSS theme variables
  favicon.ico
public/              # Static assets served from "/" (svg logos, etc.)
next.config.ts       # Next.js configuration (currently empty)
eslint.config.mjs    # ESLint flat config
postcss.config.mjs   # PostCSS — wires up Tailwind v4
tsconfig.json        # TypeScript config
```

There is no `src/` directory — the `app/` folder lives at the repo root.

## Conventions

- **App Router only.** Add new pages as `app/<route>/page.tsx` and shared
  layouts as `app/<route>/layout.tsx`. Components are Server Components by
  default; add `"use client"` at the top of a file only when you need browser
  APIs, state, or effects.
- **Import alias.** `@/*` maps to the repo root (see `tsconfig.json`). Prefer
  `@/app/...` / `@/...` over long relative paths.
- **Styling is Tailwind-first.** Use utility classes in JSX. Global styles and
  theme tokens live in `app/globals.css`. Tailwind v4 is configured via CSS
  (`@import "tailwindcss"` + `@theme`), not a `tailwind.config.js`.
- **Theme tokens.** `--background` / `--foreground` are defined in
  `globals.css` with a `prefers-color-scheme: dark` override, and exposed to
  Tailwind as `bg-background` / `text-foreground`. Reuse these for dark-mode
  support; the markup uses `dark:` variants throughout.
- **Fonts.** Geist Sans and Geist Mono are loaded in `app/layout.tsx` and
  exposed as the CSS variables `--font-geist-sans` / `--font-geist-mono`
  (mapped to `--font-sans` / `--font-mono`). Don't add `<link>` font tags;
  extend the `next/font` setup instead.
- **Images.** Use `next/image` (`<Image>`) for images, as in `app/page.tsx`.
- **TypeScript is strict.** Keep it that way — type props and avoid `any`.

## Verifying changes

Before considering a change complete, run:

```bash
npm run lint && npm run build
```

`build` is the de-facto typecheck since there's no standalone script. If you
add a UI change, also start `npm run dev` and confirm it renders.

## Git workflow

- Default branch: `main`.
- Do not push directly to `main`. Develop on a feature branch and open a PR
  only when asked.
- Keep commits focused with clear, descriptive messages.

## Notes for future updates

This file describes a boilerplate. As real features land, update it with the
actual app domain, any added directories (e.g. `app/api/`, `components/`,
`lib/`), new dependencies, and the test/format tooling once introduced.
