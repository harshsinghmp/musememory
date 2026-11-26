/**
 * Type declarations for the Studio assets imported with Bun's text loader
 * (`import STUDIO_JS from "./studio.js" with { type: "text" }`). Bun resolves
 * these imports to the file's bytes at build time; TypeScript has no built-in
 * notion of the loader, so the modules are declared here as default string
 * exports. The `.js` pattern is scoped to this directory on purpose: a global
 * `*.js` wildcard would type every JavaScript module as a string.
 */
declare module "*.css" {
  const content: string;
  export default content;
}

declare module "*.html" {
  const content: string;
  export default content;
}

declare module "*/ui/assets/studio.js" {
  const content: string;
  export default content;
}
