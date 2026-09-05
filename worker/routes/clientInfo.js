import { checkRateLimit, clientIp, jsonResponse } from "../shared.js";

// ISP name + city/country for the display around the GO button — looked
// up by IP via ip-api.com's free tier (no key required, ~45 req/min
// limit). Looks up the *client's* IP specifically (CF-Connecting-IP,
// always accurate — Cloudflare terminates the real connection), not
// this Worker's own outbound IP, which would just describe Cloudflare's
// own network instead of the visitor's.
export async function clientInfo(request, env) {
  const limited = await checkRateLimit(env, "RL_CLIENT_INFO", request);
  if (limited) return limited;

  const ip = clientIp(request);
  if (!ip || ip === "unknown") {
    return jsonResponse({ isp: null, location: null, ip: null });
  }

  // Private/loopback addresses (local dev) aren't geolocatable —
  // ip-api.com would just return a "private range" error for these.
  if (ip === "127.0.0.1" || ip === "::1" || ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("172.16.")) {
    return jsonResponse({ isp: null, location: null, ip });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(`http://ip-api.com/json/${ip}?fields=status,isp,city,country,query`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await resp.json();
    if (data.status !== "success") {
      return jsonResponse({ isp: null, location: null, ip });
    }
    const location = [data.city, data.country].filter(Boolean).join("، ");
    return jsonResponse({ isp: data.isp || null, location: location || null, ip: data.query || ip });
  } catch (e) {
    // Best-effort — a failed lookup shouldn't break the page, the
    // frontend just shows nothing in the ISP/location slots.
    return jsonResponse({ isp: null, location: null, ip });
  }
}
