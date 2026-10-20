import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Vite place tout le corps de import(...).then(...) dans son wrapper de préchargement : une erreur de connect() y passait pour
// un morceau introuvable, NewVersion l'avalait et getApi rendait undefined (« reading 'createProfile' », octobre 2026).
test("App.jsx : connect() et demoApi() appelés hors de import(...).then", () => {
  const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /import\([^)]*\)\s*\.then\(\s*m\s*=>\s*m\.(connect|demoApi)\(/);
  assert.match(src, /e\.type === "vite:preloadError" && !CHUNK\.test/, "preventDefault réservé aux vrais échecs de chargement");
});
