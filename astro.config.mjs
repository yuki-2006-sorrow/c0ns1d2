import { defineConfig } from 'astro/config';

export default defineConfig({
  cacheDir: './.astro/cache',
  site: 'https://c0ns1d2.pages.dev',
  vite: {
    ssr: {
      noExternal: [],
    },
  },
});
