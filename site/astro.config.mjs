import react from "@astrojs/react";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://pqattest.com",
  integrations: [react()],
  devToolbar: { enabled: false },
  vite: {
    envDir: "..",
    resolve: {
      alias: {
        buffer: "buffer",
        "node:buffer": "buffer",
      },
    },
    define: {
      global: "globalThis",
    },
    // Dev compiles JSX to jsxDEV. Dep prebundling must keep React's development
    // runtime; a production prebundle sets jsxDEV to undefined and hydration
    // throws, which removes the server-rendered experiments markup.
    optimizeDeps: {
      rolldownOptions: {
        transform: {
          define: {
            "process.env.NODE_ENV": JSON.stringify("development"),
          },
        },
      },
    },
  },
});
