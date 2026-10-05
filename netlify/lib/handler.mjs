// Bridges Netlify Functions (Web Request/Response) to the Node-style handler in server/core.js.
export function makeHandler(app) {
  return async (request, context = {}) => {
    const url = new URL(request.url);
    const headers = Object.fromEntries(request.headers);
    if (context.ip) headers['x-nf-client-connection-ip'] = context.ip;
    const req = { method: request.method, headers, rawBody: await request.text(), socket: {} };
    let status = 200, outHeaders = {}, body = '';
    const res = {
      headersSent: false,
      writeHead(s, h = {}) { status = s; outHeaders = h; },
      end(d = '') { body = d; this.headersSent = true; }
    };
    await app.handle(req, res, url);
    return new Response(status === 204 ? null : body, { status, headers: outHeaders });
  };
}
