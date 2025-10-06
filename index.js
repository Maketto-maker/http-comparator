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
  if (!cookieB) cookieB = cookieA; // fallback to A if B is missing
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

  const table = new Table({
    head: [chalk.gray('#'), chalk.gray('URL A'), chalk.gray('URL B'), chalk.gray('Status')],
    wordWrap: true,
    colWidths: [5, 80, 80, 12]
  });

  const results = [];

  // Debug mode: fetch URL A of a selected pair and print raw HTML, then exit
  if (argv.debug) {
    const idx = Math.min(Math.max(1, Number(argv['debug-index']) || 1), urlPairs.length);
    const [urlA] = urlPairs[idx - 1];
    const step = ora(`Debug: fetching URL A (#${idx}) ${requestTarget(urlA)}`).start();
    try {
      const dbgReferer = argv['referer-a'] || argv['referer'] || '';
      const resA = await fetchHtml(urlA, { cookie: cookieHeader.A, timeout: argv.timeout, retries: argv.retries, insecure: argv.insecure, referer: dbgReferer });
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
        fetchHtml(urlA, { cookie: cookieHeader.A, timeout: argv.timeout, retries: argv.retries, insecure: argv.insecure, referer: refererA }),
        fetchHtml(urlB, { cookie: cookieHeader.B, timeout: argv.timeout, retries: argv.retries, insecure: argv.insecure, referer: refererB })
      ]);

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

  // Summary & exit code
  const passCount = results.filter(r => r.pass).length;
  const failCount = results.length - passCount;
  printSummary({ total: results.length, pass: passCount, fail: failCount });
  process.exit(failCount > 0 ? 1 : 0);
})();