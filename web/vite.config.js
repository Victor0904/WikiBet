import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { exclude: ["@electric-sql/pglite"] }, // PGlite charge son propre WebAssembly
  build: { sourcemap: "hidden" }, // cartes générées pour déboguer, sans lien dans les fichiers servis
});
