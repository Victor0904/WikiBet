import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LEVS } from "../supabase/functions/_shared/progression.js";

// La fonction aurelys filtre les leviers avant la base : sa liste doit contenir tous ceux du jeu (×2 manquait après H3,
// tout ordre ×2 était refusé « Ordre invalide. » en ligne, alors que la démo, qui passe directement par SQL, l'acceptait).
test("fonction aurelys : tous les leviers du jeu sont acceptés", () => {
  const src = readFileSync(new URL("../supabase/functions/aurelys/index.ts", import.meta.url), "utf8");
  const m = /!\[([\d, ]+)\]\.includes\(lev\)/.exec(src);
  assert.ok(m, "liste des leviers introuvable dans la fonction");
  const ok = m[1].split(",").map(Number);
  for (const v of LEVS) assert.ok(ok.includes(v), `×${v} refusé par la fonction`);
});
