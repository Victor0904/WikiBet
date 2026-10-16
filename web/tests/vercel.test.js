import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Un vercel.json illisible bloque tout déploiement (octobre 2026) ; les routes du jeu passent par index.html.
test("vercel.json : JSON valide, toute adresse inconnue sert index.html", () => {
  const v = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.deepEqual(v.rewrites, [{ source: "/(.*)", destination: "/index.html" }]);
});
