/**
 * Pre-launch gate for the Cloudflare Pages site: HTTP Basic Auth on every request (wrangler
 * picks up apps/playground/functions when deploying). Not a secret: it only keeps the unreleased
 * site away from visitors and crawlers. Delete this file and redeploy to go public.
 */
const USER = "truedxf";
const PASSWORD = "truedxf";

interface PagesContext {
  request: Request;
  next(): Promise<Response>;
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.headers.get("Authorization") === `Basic ${btoa(`${USER}:${PASSWORD}`)}`)
    return context.next();
  return new Response("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="truedxf (pre-release)"', "X-Robots-Tag": "noindex" },
  });
}
