import { defineConfig } from "astro/config";

// Static output for GitHub Pages; no SSR adapter needed.
export default defineConfig({
  site: "https://harshsinghmp.github.io",
  base: "/musememory",
  output: "static",
  build: {
    inlineStylesheets: "auto",
  },
});
