const got = require('got');
let ToughCookie;
try { ToughCookie = require('tough-cookie'); } catch (_) { ToughCookie = null; }

module.exports = async function fetchHtml(url, opts = {}) {
  const {
    cookie = '',
    cookieJar = null,
    timeout = 15000,
    retries = 0,
    insecure = false,
    referer = '',
  } = opts;
  try {
    // Determine Sec-Fetch-Site based on referer vs target
    let secFetchSite = 'none';
    if (referer) {
      try {
        const target = new URL(url);
        const ref = new URL(referer);
        const hostPieces = (h) => h.split('.').slice(-2).join('.');
        secFetchSite = hostPieces(target.hostname) === hostPieces(ref.hostname) ? 'same-site' : 'cross-site';
      } catch (_) { secFetchSite = 'none'; }
    }

    const requestHeaders = {
      // Emulate a modern Chromium browser request as closely as possible
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'en-US,en;q=0.9,ja;q=0.8,ak;q=0.7,ru;q=0.6',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Upgrade-Insecure-Requests': '1',
      'Priority': 'u=0, i',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': secFetchSite,
      'Sec-Fetch-User': '?1',
      'Sec-CH-UA': '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
      'Sec-CH-UA-Mobile': '?0',
      'Sec-CH-UA-Platform': '"Windows"',
    };
    if (referer) requestHeaders['Referer'] = referer;
    let effectiveCookie = '';
    if (cookieJar && ToughCookie) {
      // Use the provided cookie jar (which maintains state across requests)
      try { effectiveCookie = await cookieJar.getCookieString(url); } catch (_) { effectiveCookie = ''; }
    } else if (ToughCookie) {
      // Fallback: create a new cookie jar for this request only
      const localJar = new ToughCookie.CookieJar();
      if (cookie) {
        const parts = String(cookie).split(';');
        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed) continue;
          try { await localJar.setCookie(trimmed, url); } catch (_) {}
        }
      }
      try { effectiveCookie = await localJar.getCookieString(url); } catch (_) { effectiveCookie = ''; }
      cookieJar = localJar;
    } else {
      if (cookie) { requestHeaders['Cookie'] = cookie; effectiveCookie = cookie; }
    }
    const resp = await got(url, {
      headers: requestHeaders,
      responseType: 'text',
      timeout: { request: timeout },
      http2: true,
      followRedirect: true,
      decompress: true,
      throwHttpErrors: false,
      https: { rejectUnauthorized: !insecure },
      ...(cookieJar ? { cookieJar } : {}),
      retry: {
        limit: retries,
        methods: ['GET'],
        statusCodes: [408, 413, 429, 500, 502, 503, 504],
        calculateDelay: ({ attemptCount, retryOptions, error }) => {
          if (attemptCount > retryOptions.limit) return 0;
          return Math.min(2000 * Math.pow(2, attemptCount - 1), 8000);
        }
      }
    });

    const contentType = resp.headers['content-type'] || '';
    const isHtml = /text\/html|application\/xhtml\+xml/i.test(contentType);

    return {
      ok: resp.statusCode >= 200 && resp.statusCode < 300 && isHtml,
      statusCode: resp.statusCode,
      headers: resp.headers,
      body: isHtml ? resp.body : '',
      requestHeaders: { ...requestHeaders, ...(effectiveCookie ? { 'Cookie': effectiveCookie } : {}) }
    };
  } catch (err) {
    const requestHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'en-US,en;q=0.9,ja;q=0.8,ak;q=0.7,ru;q=0.6',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Upgrade-Insecure-Requests': '1',
      'Priority': 'u=0, i',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Sec-CH-UA': '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
      'Sec-CH-UA-Mobile': '?0',
      'Sec-CH-UA-Platform': '"Windows"',
      ...(cookie ? { 'Cookie': cookie } : {})
    };
    return { ok: false, statusCode: 0, headers: {}, body: '', error: err, requestHeaders };
  }
};