import tailwindcss from "@tailwindcss/vite";
import adapter from "@sveltejs/adapter-cloudflare";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import { SvelteKitPWA } from "@vite-pwa/sveltekit";

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      compilerOptions: {
        // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
        runes: ({ filename }) => (filename.split(/[/\\]/).includes("node_modules") ? undefined : true),
      },
      adapter: adapter({
        config: "./wrangler.jsonc",
        platformProxy: {
          // Shared with `consumer/` (see its `pnpm dev` script) so both
          // workers see the same local D1/R2 data in dev — otherwise each
          // `wrangler`/proxy instance defaults to its own package-local
          // `.wrangler/state` and meetings written by one are invisible to
          // the other.
          persist: { path: "../.wrangler/state" },
        },
      }),
    }),
    // SvelteKitPWA({
    //   registerType: "autoUpdate",
    //   manifest: {
    //     name: "lz-notes",
    //     short_name: "lz-notes",
    //     description: "Turn recorded meetings into structured notes.",
    //     theme_color: "#000000",
    //     background_color: "#ffffff",
    //     display: "standalone",
    //     start_url: "/",
    //     icons: [
    //       { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
    //       { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    //     ],
    //   },
    // }),
  ],
});
