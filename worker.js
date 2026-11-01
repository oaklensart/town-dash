// Cloudflare Worker entry point for the standalone Town Dash.
// Routes `/api/city` to the edge aggregator and serves static assets for all
// other paths.
import { handleCity } from './src/api/city.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/city') {
      return handleCity(request, url, ctx, env);
    }
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response('Not found', { status: 404 });
  },
};
