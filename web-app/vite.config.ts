import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@lms/shared": path.resolve(__dirname, "../shared/src/index.ts") }
  },
  server: {
    port: 5174,
    proxy: {
      "/api": "http://localhost:4000",
      "/socket.io": { target: "http://localhost:4000", ws: true }
    }
  }
});
