import { defineConfig } from "astro/config";

// Static output for GitHub Pages; no SSR adapter needed.
export default defineConfig({
  site: "https://harshsinghmp.github.io",
  base: "/musememory",
  output: "static",
  build: {
    inlineStylesheets: "auto",
  },
  vite: {
    server: {
      fs: {
        // The site imports `claims.json` from the repository root so that
        // every published number comes from one generated manifest instead of
        // being hand-typed into prose. The dev server has to be allowed to
        // read outside the site directory for that import to resolve.
        allow: ["../.."],
      },
    },
  },
});
