export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/config') {
      return new Response(JSON.stringify({maptilerKey: env.MAPTILER_API_KEY || ''}), {
        status: 200,
        headers: {'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':url.origin}
      });
    }
    return env.ASSETS.fetch(request);
  }
};
