// Outil local, jamais déployé. Clés lues dans web/.env.local : Vite n'expose que les VITE_* (URL et clé anon).
import { defineConfig } from "vite";
export default defineConfig({ envDir: "../web", server: { host: "localhost", port: 5174, strictPort: true } });
