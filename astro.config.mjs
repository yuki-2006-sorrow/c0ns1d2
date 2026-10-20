import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://c0ns1d2.com',
  vite: {
    ssr: {
      noExternal: [],
    },
  },
});
