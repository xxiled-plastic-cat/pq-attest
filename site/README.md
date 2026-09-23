# PQ Attest — landing page

Astro site for the human front door. The API is the Worker at the repository root. This directory builds to static HTML for Cloudflare Pages.

Placeholder hosts live in [`src/data/site.ts`](src/data/site.ts): `https://api.pqattest.example`, `https://docs.pqattest.example`, and `hello@pqattest.example`. Change them there when the real hostnames exist.

## Local

From this directory:

```bash
npm install
npm run dev
```

From the repository root, after `npm install` here:

```bash
npm run site
```

`npm run dev` serves the page with hot reload, usually at `http://localhost:4321`. `npm run build` writes static files to `dist/`. `npm run preview` serves that build.

## Cloudflare Pages

Build command: `npm run build`  
Build output directory: `site/dist`  
Root directory: `site`

Or from this directory, after `npx wrangler pages project create pq-attest-site --production-branch main`:

```bash
npm run build
npx wrangler pages deploy dist --project-name pq-attest-site
```
