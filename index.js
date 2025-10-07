#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const ora = require('ora');
const chalk = require('chalk');
const Table = require('cli-table3');

const fetchHtml = require('./lib/fetch');
const extractMenu = require('./lib/extract');
const normalizeHtml = require('./lib/normalize');
const { compareStrings } = require('./lib/compare');
const { printSummary, printFailureDiff } = require('./lib/print');
const { requestTarget } = require('./lib/url');
const { extractAnchorTexts } = require('./lib/anchors');

function resolveFromCwd(p) { return path.resolve(process.cwd(), p); }

function cleanCookieString(str) {
  if (!str) return '';
  let s = String(str).trim();
  // Remove wrapping single or double quotes if the whole string is quoted
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    s = s.slice(1, -1);
  }
  return s.trim();
}

function parseCookiesText(text) {
  const lines = String(text).split(/\r?\n/).map(l => l.trim());
  const line1 = lines[0] || '';
  const line2 = lines[1] || '';
  const cookieA = cleanCookieString(line1);
  let cookieB = cleanCookieString(line2);
  return { cookieA, cookieB };
}

function parseUrlPairs(text) {
  const lines = text.split(/\r?\n/);
  const pairs = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue; // allow comments
    const parts = line.split(',');
    if (parts.length < 2) {
      throw new Error(`Invalid line (expected "urlA, urlB"): ${line}`);
    }
    const a = parts[0].trim();
    const b = parts.slice(1).join(',').trim(); // in case URL contains comma, join back
    if (!/^https:\/\//i.test(a) || !/^https:\/\//i.test(b)) {
      throw new Error(`Only HTTPS URLs are supported. Offending line: ${line}`);
    }
    pairs.push([a, b]);
  }
  return pairs;
}

async function delay(ms) { return new Promise(res => setTimeout(res, ms)); }

(async function main() {
  const argv = yargs(hideBin(process.argv))
    .usage('$0 [options]')
    .option('urls', { type: 'string', default: 'urls.txt', describe: 'Path to the URLs file' })
    .option('cookies', { type: 'string', default: 'cookies.txt', describe: 'Path to the cookies file' })
    .option('delay', { type: 'number', default: 1500, describe: 'Delay in ms between URL pairs' })
    .option('timeout', { type: 'number', default: 15000, describe: 'Per-request timeout in ms' })
    .option('retries', { type: 'number', default: 0, describe: 'Number of automatic retries per request' })
    .option('insecure', { type: 'boolean', default: false, describe: 'Allow insecure TLS (rejectUnauthorized=false)' })
    .option('full-diff', { type: 'boolean', default: false, describe: 'Print full diff for failures' })
    .option('debug', { type: 'boolean', default: false, describe: 'Debug: fetch URL A from urls and print raw HTML' })
    .option('debug-index', { type: 'number', default: 1, describe: '1-based index of pair to debug' })
    .option('referer', { type: 'string', describe: 'Referer to send with both A and B requests' })
    .option('referer-a', { type: 'string', describe: 'Referer to send with A requests (overrides --referer)' })
    .option('referer-b', { type: 'string', describe: 'Referer to send with B requests (overrides --referer)' })
    .option('update-cookies', { type: 'boolean', default: true, describe: 'Update cookies file with new cookies received from server' })
    .option('login-check', { type: 'boolean', default: false, describe: 'Check login status: test URL A with cookie A and URL B with cookie B, report Internal Server Error' })
    .help()
    .argv;

  const urlsPath = resolveFromCwd(argv.urls);
  const cookiesPath = resolveFromCwd(argv.cookies);

  if (!fs.existsSync(urlsPath)) {
    console.error(chalk.red(`Missing urls file: ${urlsPath}`));
    process.exit(1);
  }
  if (!fs.existsSync(cookiesPath)) {
    console.error(chalk.red(`Missing cookies file: ${cookiesPath}`));
    process.exit(1);
  }

  const spinner = ora('Reading urls and cookies...').start();
  let urlPairs, cookieHeader;
  try {
    const urlsText = fs.readFileSync(urlsPath, 'utf8');
    const cookiesText = fs.readFileSync(cookiesPath, 'utf8');
    urlPairs = parseUrlPairs(urlsText);
    const { cookieA, cookieB } = parseCookiesText(cookiesText);
    cookieHeader = { A: cookieA, B: cookieB };
    spinner.succeed('Loaded input files.');
  } catch (err) {
    spinner.fail('Failed to load inputs');
    console.error(chalk.red(err.message));
    process.exit(1);
  }

  // Cookie jar for maintaining cookie state across requests
  let ToughCookie;
  try { 
    ToughCookie = require('tough-cookie'); 
  } catch (err) { 
    ToughCookie = null; 
    console.log(chalk.red('✗ tough-cookie failed to load:'), err.message);
  }
  
  const cookieJars = {
    A: ToughCookie ? new ToughCookie.CookieJar() : null,
    B: ToughCookie ? new ToughCookie.CookieJar() : null
  };

  // Initialize cookie jars with initial cookies using actual URL domains
  if (ToughCookie && urlPairs.length > 0) {
    const [firstUrlA, firstUrlB] = urlPairs[0];
    
    for (const [key, jar] of Object.entries(cookieJars)) {
      const initialCookie = key === 'A' ? cookieHeader.A : cookieHeader.B;
      const targetUrl = key === 'A' ? firstUrlA : firstUrlB;
      
      if (initialCookie) {
        const parts = String(initialCookie).split(';');
        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed) continue;
          try {
            // Use the actual URL domain for cookie setup
            await jar.setCookie(trimmed, targetUrl);
          } catch (_) {}
        }
      }
    }
  }

  const table = new Table({
    head: [chalk.gray('#'), chalk.gray('URL A'), chalk.gray('URL B'), chalk.gray('Status')],
    wordWrap: true,
    colWidths: [5, 80, 80, 12]
  });

  const results = [];

  // Login check mode: test both URLs with their respective cookies
  if (argv['login-check']) {
    const loginCheckSpinner = ora('Checking login status...').start();
    const loginResults = [];
    
    for (let i = 0; i < 1; i++) {
      const [urlA, urlB] = urlPairs[i];
      const pairLabel = `${requestTarget(urlA)}  vs  ${requestTarget(urlB)}`;
      
      try {
        const refererA = argv['referer-a'] || argv['referer'] || '';
        const refererB = argv['referer-b'] || argv['referer'] || '';
        
        const [resA, resB] = await Promise.all([
          fetchHtml(urlA, { cookieJar: cookieJars.A, timeout: argv.timeout, retries: argv.retries, insecure: argv.insecure, referer: refererA }),
          fetchHtml(urlB, { cookieJar: cookieJars.B, timeout: argv.timeout, retries: argv.retries, insecure: argv.insecure, referer: refererB })
        ]);
        
        // Check for "Internal Server Error" and login requirements in response body
        const hasErrorA = resA.body && typeof resA.body === 'string' && resA.body.toLowerCase().includes('internal server error');
        const hasErrorB = resB.body && typeof resB.body === 'string' && resB.body.toLowerCase().includes('internal server error');

        // Check for login requirement indicators
        const requiresLoginA = resA.body && typeof resA.body === 'string' &&
                              (resA.body.toLowerCase().includes('log in to market observer to continue to market observer') ||
                               resA.body.toLowerCase().includes('please log in') ||
                               resA.body.toLowerCase().includes('login required') ||
                               resA.body.toLowerCase().includes('authentication required'));
        const requiresLoginB = resB.body && typeof resB.body === 'string' &&
                              (resB.body.toLowerCase().includes('log in to market observer to continue to market observer') ||
                               resB.body.toLowerCase().includes('please log in') ||
                               resB.body.toLowerCase().includes('login required') ||
                               resB.body.toLowerCase().includes('authentication required'));

        const statusA = hasErrorA ? 'FAIL (Internal Server Error)' :
                       requiresLoginA ? 'FAIL (Require login)' :
                       (!resA.ok ? `FAIL (HTTP ${resA.statusCode})` : 'PASS');
        const statusB = hasErrorB ? 'FAIL (Internal Server Error)' :
                       requiresLoginB ? 'FAIL (Require login)' :
                       (!resB.ok ? `FAIL (HTTP ${resB.statusCode})` : 'PASS');
        
        loginResults.push({
          index: i + 1,
          urlA,
          urlB,
          statusA,
          statusB,
          hasErrorA,
          hasErrorB,
          requiresLoginA,
          requiresLoginB,
          httpStatusA: resA.statusCode,
          httpStatusB: resB.statusCode
        });
        
      } catch (e) {
        loginResults.push({
          index: i + 1,
          urlA,
          urlB,
          statusA: `ERROR (${e.message})`,
          statusB: `ERROR (${e.message})`,
          hasErrorA: false,
          hasErrorB: false,
          requiresLoginA: false,
          requiresLoginB: false,
          httpStatusA: 0,
          httpStatusB: 0
        });
      }
      
      if (i < urlPairs.length - 1) {
        await delay(argv.delay);
      }
    }
    
    loginCheckSpinner.stop();
    
    // Display login check results
    const loginTable = new Table({
      head: [chalk.gray('#'), chalk.gray('URL A'), chalk.gray('URL B'), chalk.gray('Status A'), chalk.gray('Status B')],
      wordWrap: true,
      colWidths: [5, 60, 60, 25, 25]
    });
    
    for (const r of loginResults) {
      const statusAColor = r.hasErrorA || r.requiresLoginA ? chalk.bgRed.white(' FAIL ') :
                          (!r.httpStatusA || r.httpStatusA < 200 || r.httpStatusA >= 300) ? chalk.bgRed.white(' FAIL ') :
                          chalk.bgGreen.black(' PASS ');
      const statusBColor = r.hasErrorB || r.requiresLoginB ? chalk.bgRed.white(' FAIL ') :
                          (!r.httpStatusB || r.httpStatusB < 200 || r.httpStatusB >= 300) ? chalk.bgRed.white(' FAIL ') :
                          chalk.bgGreen.black(' PASS ');
      
      loginTable.push([
        r.index,
        chalk.cyan(requestTarget(r.urlA)),
        chalk.cyan(requestTarget(r.urlB)),
        statusAColor,
        statusBColor
      ]);
    }
    
    console.log('\n' + loginTable.toString() + '\n');
    
    // Summary
    const totalPairs = loginResults.length;
    const aFailures = loginResults.filter(r => r.hasErrorA || r.requiresLoginA || !r.httpStatusA || r.httpStatusA < 200 || r.httpStatusA >= 300).length;
    const bFailures = loginResults.filter(r => r.hasErrorB || r.requiresLoginB || !r.httpStatusB || r.httpStatusB < 200 || r.httpStatusB >= 300).length;
    const internalErrors = loginResults.filter(r => r.hasErrorA || r.hasErrorB).length;
    const loginRequiredErrors = loginResults.filter(r => r.requiresLoginA || r.requiresLoginB).length;
    
    console.log(chalk.gray('Login Check Summary:'));
    console.log(chalk.gray(`Total pairs tested: ${totalPairs}`));
    console.log(chalk.red(`URL A failures: ${aFailures}`));
    console.log(chalk.red(`URL B failures: ${bFailures}`));
    console.log(chalk.red(`Internal Server Errors: ${internalErrors}`));
    console.log(chalk.red(`Login Required Errors: ${loginRequiredErrors}`));
    
    if (argv['update-cookies'] && ToughCookie && urlPairs.length > 0) {
      try {
        const [firstUrlA, firstUrlB] = urlPairs[0];
        const newCookieA = await cookieJars.A.getCookieString(firstUrlA);
        const newCookieB = await cookieJars.B.getCookieString(firstUrlB);
        const updatedCookies = `${newCookieA}\n${newCookieB}`;
        fs.writeFileSync(cookiesPath, updatedCookies, 'utf8');
        console.log(chalk.green(`\n✓ Updated cookies file: ${cookiesPath}`));
      } catch (err) {
        console.log(chalk.yellow(`\n⚠ Failed to update cookies file: ${err.message}`));
      }
    }
    
    const hasFailures = aFailures > 0 || bFailures > 0;
    process.exit(hasFailures ? 1 : 0);
  }

  // Debug mode: fetch URL A of a selected pair and print raw HTML, then exit
  if (argv.debug) {
    const idx = Math.min(Math.max(1, Number(argv['debug-index']) || 1), urlPairs.length);
    const [urlA] = urlPairs[idx - 1];
    const step = ora(`Debug: fetching URL A (#${idx}) ${requestTarget(urlA)}`).start();
    try {
      const dbgReferer = argv['referer-a'] || argv['referer'] || '';
      const resA = await fetchHtml(urlA, { cookieJar: cookieJars.A, timeout: argv.timeout, retries: argv.retries, insecure: argv.insecure, referer: dbgReferer });
      step.stop();
      const usedCookie = (resA.requestHeaders && resA.requestHeaders['Cookie']) || '';
      console.log(chalk.gray('--- Debug info ---'));
      console.log(chalk.gray('Cookie header used: ') + (usedCookie ? chalk.yellow(usedCookie) : chalk.red('(none)')));
      if (resA.headers && resA.headers['set-cookie']) {
        const setCookie = Array.isArray(resA.headers['set-cookie']) ? resA.headers['set-cookie'].join('\n') : String(resA.headers['set-cookie']);
        console.log(chalk.gray('Set-Cookie from server:'));
        console.log(chalk.gray(setCookie));
      }
      if (!resA.ok) {
        console.error(chalk.red(`Request failed (HTTP ${resA.statusCode})`));
        process.exit(1);
      }
      process.stdout.write(resA.body);
      process.exit(0);
    } catch (e) {
      step.fail(chalk.red(`Error: ${e.message}`));
      process.exit(1);
    }
  }

  for (let i = 0; i < urlPairs.length; i++) {
    const [urlA, urlB] = urlPairs[i];
    const pairLabel = `${requestTarget(urlA)}  vs  ${requestTarget(urlB)}`;
    const step = ora(`Fetching [${i + 1}/${urlPairs.length}] ${pairLabel}`).start();

 
    try {
      const refererA = argv['referer-a'] || argv['referer'] || '';
      const refererB = argv['referer-b'] || argv['referer'] || '';
      const [resA, resB] = await Promise.all([
        fetchHtml(urlA, { cookieJar: cookieJars.A, timeout: argv.timeout, retries: argv.retries, insecure: argv.insecure, referer: refererA }),
        fetchHtml(urlB, { cookieJar: cookieJars.B, timeout: argv.timeout, retries: argv.retries, insecure: argv.insecure, referer: refererB })
      ]);

      // Log cookie changes after each request
      if (i === 0) {
        console.log(chalk.gray('After first request - Cookies for URL A:') + chalk.yellow(await cookieJars.A.getCookieString(urlA)));
        console.log(chalk.gray('After first request - Cookies for URL B:') + chalk.yellow(await cookieJars.B.getCookieString(urlB)));
      }

      if (!resA.ok) {
        const aExtra = resA.statusCode === 0 && resA.error ? ` ${resA.error.code || ''} ${resA.error.message || ''}`.trim() : '';
        step.fail(chalk.red(`A failed (${resA.statusCode}${aExtra ? ' ' + aExtra : ''})`));
        results.push({ index: i + 1, urlA, urlB, pass: false, reason: `A HTTP ${resA.statusCode}${aExtra ? ' ' + aExtra : ''}`.trim(), diff: '' });
      } else if (!resB.ok) {
        const bExtra = resB.statusCode === 0 && resB.error ? ` ${resB.error.code || ''} ${resB.error.message || ''}`.trim() : '';
        step.fail(chalk.red(`B failed (${resB.statusCode}${bExtra ? ' ' + bExtra : ''})`));
        results.push({ index: i + 1, urlA, urlB, pass: false, reason: `B HTTP ${resB.statusCode}${bExtra ? ' ' + bExtra : ''}`.trim(), diff: '' });
      } else {
        const innerA = extractMenu(resA.body);
        const innerB = extractMenu(resB.body);

        if (innerA.missing || innerB.missing) {
          const which = innerA.missing ? 'A' : 'B';
          step.fail(chalk.red(`#dropmenu missing in ${which}`));
          results.push({ index: i + 1, urlA, urlB, pass: false, reason: `#dropmenu missing in ${which}`, diff: '' });
        } else {
          const textsA = extractAnchorTexts(innerA.html);
          const textsB = extractAnchorTexts(innerB.html);
          const listA = textsA.join('\n');
          const listB = textsB.join('\n');
          const cmp = compareStrings(listA, listB);
          if (cmp.equal) {
            step.succeed(chalk.green('PASS'));
            results.push({ index: i + 1, urlA, urlB, pass: true, reason: 'Identical anchors', diff: '' });
          } else {
            step.fail(chalk.red('FAIL'));
            const info = `Anchor counts: A=${textsA.length}, B=${textsB.length}`;
            results.push({ index: i + 1, urlA, urlB, pass: false, reason: info, diff: cmp.diff });
          }
        }
      }
    } catch (e) {
      step.fail(chalk.red(`Error: ${e.message}`));
      results.push({ index: i + 1, urlA, urlB, pass: false, reason: e.message, diff: '' });
    }

    if (i < urlPairs.length - 1) {
      await delay(argv.delay);
    }
  }

  // Build the table
  for (const r of results) {
    table.push([
      r.index,
      chalk.cyan(requestTarget(r.urlA)),
      chalk.cyan(requestTarget(r.urlB)),
      r.pass ? chalk.bgGreen.black(' PASS ') : chalk.bgRed.white(' FAIL ')
    ]);
  }
  console.log('\n' + table.toString() + '\n');

  // Print diffs for failures
  const showFull = Boolean(argv['full-diff']);
  for (const r of results.filter(x => !x.pass && x.diff)) {
    printFailureDiff(r, { full: showFull });
  }

  // Update cookies file if requested
  if (argv['update-cookies'] && ToughCookie && urlPairs.length > 0) {
    try {
      const [firstUrlA, firstUrlB] = urlPairs[0];
      const newCookieA = await cookieJars.A.getCookieString(firstUrlA);
      const newCookieB = await cookieJars.B.getCookieString(firstUrlB);
      const updatedCookies = `${newCookieA}\n${newCookieB}`;
      fs.writeFileSync(cookiesPath, updatedCookies, 'utf8');
      console.log(chalk.green(`\n✓ Updated cookies file: ${cookiesPath}`));
    } catch (err) {
      console.log(chalk.yellow(`\n⚠ Failed to update cookies file: ${err.message}`));
    }
  }

  // Summary & exit code
  const passCount = results.filter(r => r.pass).length;
  const failCount = results.length - passCount;
  printSummary({ total: results.length, pass: passCount, fail: failCount });
  process.exit(failCount > 0 ? 1 : 0);
})();