import react from "@astrojs/react";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://pqattest.com",
  integrations: [react()],
  devToolbar: { enabled: false },
  vite: {
    resolve: {
      alias: {
        buffer: "buffer",
        "node:buffer": "buffer",
      },
    },
    define: {
      global: "globalThis",
    },
  },
});
