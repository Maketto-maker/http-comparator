const got = require('got');
let ToughCookie;
try { ToughCookie = require('tough-cookie'); } catch (_) { ToughCookie = null; }

// Helper function to detect if this is an OAuth2 authorization redirect
function isOAuth2AuthorizeUrl(url) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.pathname.includes('/authorize') &&
           parsedUrl.searchParams.has('response_type') &&
           parsedUrl.searchParams.has('client_id') &&
           parsedUrl.searchParams.has('redirect_uri');
  } catch (_) {
    return false;
  }
}

// Helper function to detect if this is an OAuth2 callback URL
function isOAuth2CallbackUrl(url) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.pathname.includes('/auth_callback') &&
           (parsedUrl.searchParams.has('code') || parsedUrl.searchParams.has('error'));
  } catch (_) {
    return false;
  }
}

// Helper function to detect if response contains a login form
function isLoginForm(body) {
  if (!body || typeof body !== 'string') return false;
  return body.includes('Log in to Market Observer') &&
         body.includes('form') &&
         (body.includes('username') || body.includes('email')) &&
         body.includes('password');
}

// Helper function to extract form data and submit login
async function submitLoginForm(loginPageUrl, loginPageBody, headers, options, username, password) {
  const { timeout, insecure, cookieJar } = options;

  // Parse the login form to extract action URL and hidden fields
  const cheerio = require('cheerio');
  const $ = cheerio.load(loginPageBody);

  // Find the login form
  const form = $('form[data-form-primary="true"]').first();
  if (form.length === 0) {
    throw new Error('Login form not found');
  }

  // Extract form action (relative to current URL)
  const formAction = form.attr('action') || '/u/login';
  const submitUrl = new URL(formAction, loginPageUrl).toString();

  // Extract hidden fields
  const formData = {};
  form.find('input[type="hidden"]').each((_, input) => {
    const name = $(input).attr('name');
    const value = $(input).attr('value');
    if (name && value) {
      formData[name] = value;
    }
  });

  // Add username and password
  formData.username = username;
  formData.password = password;
  formData.action = 'default';  // Based on the form structure we saw

  // Convert form data to URL-encoded string
  const formBody = Object.keys(formData)
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(formData[key])}`)
    .join('&');

  // Submit the login form
  const loginHeaders = {
    ...headers,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(formBody),
    'Origin': new URL(loginPageUrl).origin,
    'Referer': loginPageUrl,
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
  };

  const response = await got(submitUrl, {
    method: 'POST',
    headers: loginHeaders,
    body: formBody,
    responseType: 'text',
    timeout: { request: timeout },
    http2: true,
    followRedirect: false,  // Handle redirects manually
    decompress: true,
    throwHttpErrors: false,
    https: { rejectUnauthorized: !insecure },
    ...(cookieJar ? { cookieJar } : {}),
  });

  return response;
}

// Handle OAuth2 token refresh flow by following redirects manually
async function handleTokenRefreshFlow(initialUrl, headers, options) {
  const { timeout, insecure, cookieJar, retries, username, password } = options;
  let currentUrl = initialUrl;
  let maxRedirects = 10;
  let redirectCount = 0;
  let oAuth2FlowOccurred = false;
  let loginOccurred = false;

  while (redirectCount < maxRedirects) {
    const response = await got(currentUrl, {
      headers: headers,
      responseType: 'text',
      timeout: { request: timeout },
      http2: true,
      followRedirect: false, // Handle redirects manually
      decompress: true,
      throwHttpErrors: false,
      https: { rejectUnauthorized: !insecure },
      ...(cookieJar ? { cookieJar } : {}),
      retry: {
        limit: retries,
        methods: ['GET'],
        statusCodes: [408, 413, 429, 500, 502, 503, 504],
      }
    });

    // Check for HTTP 500 errors during OAuth2 flow - mark as FAIL and stop
    if (response.statusCode === 500) {
      console.log('[OAuth2 Flow] HTTP 500 error encountered, stopping OAuth2 flow');
      response.oAuth2FlowOccurred = oAuth2FlowOccurred;
      response.loginOccurred = loginOccurred;
      return response;
    }

    // If not a redirect, check if it's a login form that we can handle
    if (response.statusCode < 300 || response.statusCode >= 400) {
      // If this is a login form and we have credentials, try to log in
      if (response.statusCode === 200 && username && password && isLoginForm(response.body)) {
        try {
          console.log('[OAuth2 Flow] Login form detected, attempting automatic login...');
          const loginResponse = await submitLoginForm(currentUrl, response.body, headers, options, username, password);
          loginOccurred = true;

          // If login resulted in a redirect, continue following redirects
          if (loginResponse.statusCode >= 300 && loginResponse.statusCode < 400) {
            const location = loginResponse.headers.location;
            if (location) {
              currentUrl = new URL(location, currentUrl).toString();
              redirectCount++;
              console.log(`[OAuth2 Flow] Login successful, redirecting to: ${currentUrl}`);
              continue; // Continue the redirect loop
            }
          }

          // If login was successful but didn't redirect, return the response
          if (loginResponse.statusCode >= 200 && loginResponse.statusCode < 300) {
            console.log('[OAuth2 Flow] Login completed successfully');
            loginResponse.oAuth2FlowOccurred = oAuth2FlowOccurred;
            loginResponse.loginOccurred = loginOccurred;
            return loginResponse;
          }

          // Login failed, return the original login page
          console.log(`[OAuth2 Flow] Login failed with status: ${loginResponse.statusCode}`);
          response.oAuth2FlowOccurred = oAuth2FlowOccurred;
          response.loginOccurred = loginOccurred;
          return response;
        } catch (loginError) {
          console.log(`[OAuth2 Flow] Login attempt failed: ${loginError.message}`);
          response.oAuth2FlowOccurred = oAuth2FlowOccurred;
          response.loginOccurred = loginOccurred;
          return response;
        }
      }

      response.oAuth2FlowOccurred = oAuth2FlowOccurred;
      response.loginOccurred = loginOccurred;

      return response;
    }

    // Handle redirect
    const location = response.headers.location;
    if (!location) {
      return response; // No location header, return as-is
    }

    // Resolve relative URLs
    currentUrl = new URL(location, currentUrl).toString();
    redirectCount++;

    // Mark that OAuth2 flow occurred (any redirect indicates potential OAuth2 flow)
    oAuth2FlowOccurred = true;

    // Update Sec-Fetch-Site header for the next request based on domain change
    const currentDomain = new URL(currentUrl);
    const initialDomain = new URL(initialUrl);
    const hostPieces = (h) => h.split('.').slice(-2).join('.');

    if (hostPieces(currentDomain.hostname) === hostPieces(initialDomain.hostname)) {
      headers['Sec-Fetch-Site'] = 'same-site';
    } else {
      headers['Sec-Fetch-Site'] = 'cross-site';
    }

    console.log(`[OAuth2 Flow] Redirect ${redirectCount}/${maxRedirects}: ${currentUrl}`);
  }

  // Too many redirects - but don't throw error, return empty response with debug info
  console.log(`[OAuth2 Flow] Maximum redirects exceeded (${maxRedirects}), returning empty response`);
  return {
    statusCode: 0,
    headers: {},
    body: '',
    ok: false,
    oAuth2FlowOccurred: oAuth2FlowOccurred,
    loginOccurred: loginOccurred
  };
}

module.exports = async function fetchHtml(url, opts = {}) {
  const {
    cookie = '',
    cookieJar = null,
    timeout = 15000,
    retries = 0,
    insecure = false,
    referer = '',
    followTokenRefresh = false,
    username = '',
    password = '',
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
    let resp;

    if (followTokenRefresh) {
      // Custom redirect handling for OAuth2 token refresh flow
      resp = await handleTokenRefreshFlow(url, requestHeaders, {
        timeout,
        insecure,
        cookieJar,
        retries,
        username,
        password
      });
    } else {
      // Standard got request with built-in redirect following
      resp = await got(url, {
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
    }

    const contentType = resp.headers['content-type'] || '';
    const isHtml = /text\/html|application\/xhtml\+xml/i.test(contentType);

    return {
      ok: resp.statusCode >= 200 && resp.statusCode < 300 && isHtml,
      statusCode: resp.statusCode,
      headers: resp.headers,
      body: isHtml ? resp.body : '',
      requestHeaders: { ...requestHeaders, ...(effectiveCookie ? { 'Cookie': effectiveCookie } : {}) },
      oAuth2FlowOccurred: resp.oAuth2FlowOccurred || false,
      loginOccurred: resp.loginOccurred || false
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
    return {
      ok: false,
      statusCode: 0,
      headers: {},
      body: '',
      error: err,
      requestHeaders,
      oAuth2FlowOccurred: err.oAuth2FlowOccurred || false,
      loginOccurred: err.loginOccurred || false
    };
  }
};