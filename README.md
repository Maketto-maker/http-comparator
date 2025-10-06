## HTTPS Menu Comparator

CLI tool to fetch two HTTPS pages, extract the `#dropmenu` contents, reduce noise by comparing the inner texts of all anchor tags, and report differences.

### What it does
- Fetches URL pairs (A vs B) from `urls.txt`
- Sends realistic browser-like headers; supports HTTP/2
- Uses separate cookies for A and B from `cookies.txt`
- Optionally sets `Referer` headers (per A/B) and computes `Sec-Fetch-Site`
- Extracts `#dropmenu` and compares newline-joined inner texts of all `a` tags
- Prints a result table and diffs for failures
- Debug mode to fetch a single URL A and print raw HTML and cookie info

## Prerequisites
- Node.js >= 16
- npm (or yarn/pnpm)

Install dependencies:
```bash
npm install
```

Optional (improves cookie handling across redirects):
```bash
npm install tough-cookie
```

## Files
- `index.js`: main CLI
- `lib/fetch.js`: HTTP client (browser-like headers, optional cookie jar)
- `lib/extract.js`: extracts `#dropmenu` inner HTML
- `lib/anchors.js`: builds a normalized list of anchor inner texts
- `lib/compare.js`: textual diff utilities
- `lib/print.js`: summary and diff printing
- `lib/url.js`: prints request-target (path + query + hash) only
- `urls.txt`: input URL pairs (CSV, one pair per line)
- `cookies.txt`: cookies for A (line 1) and B (line 2)

## Input formats
### urls.txt
Each non-empty line: `URL_A, URL_B`
Comments are allowed with `#` at line start. Only HTTPS URLs are accepted.

Example:
```text
https://it.example.com/path?a=1, https://st.example.com/path?a=1
# another pair
https://a.example.com/menu, https://b.example.com/menu
```

### cookies.txt
- Line 1: Cookies for URL A
- Line 2: Cookies for URL B (falls back to A if empty/missing)

Example:
```text
JSESSIONID=abc; it-m=...; _ga=...
JSESSIONID=def; st-m=...; _ga=...
```

Tip: paste browser cookies as-is. Wrapping quotes are stripped automatically.

## Usage
Run the comparator:
```bash
node index.js
```

Common flags:
- `--urls <path>`: path to `urls.txt` (default `urls.txt`)
- `--cookies <path>`: path to `cookies.txt` (default `cookies.txt`)
- `--timeout <ms>`: per-request timeout (default 15000)
- `--retries <n>`: automatic retries for transient HTTP errors (default 0)
- `--delay <ms>`: delay between pairs (default 1500)
- `--insecure`: allow insecure TLS (sets `rejectUnauthorized=false`)
- `--full-diff`: print full diff for failures (instead of first ~200 lines)
- `--referer <url>`: Referer for both A and B
- `--referer-a <url>`: Referer for A (overrides `--referer`)
- `--referer-b <url>`: Referer for B (overrides `--referer`)

Examples:
```bash
# Basic run
node index.js

# Increase timeout and enable two retries
node index.js --timeout=30000 --retries=2

# Provide referer only for B
node index.js --referer-b="https://st-project.marketobserver.asia/"

# Show full diffs
node index.js --full-diff
```

## Debug mode
Fetches only URL A for a selected pair, prints raw HTML to stdout, and shows cookie info used.

Flags:
- `--debug`: enable debug mode
- `--debug-index <n>`: 1-based pair index to debug (default 1)
- `--referer` / `--referer-a`: apply referer to debug request

Example:
```bash
node index.js --debug --debug-index=1 --timeout=30000 --referer-a="https://st-project.marketobserver.asia/"
```

Debug output includes:
- Cookie header used (post-jar resolution if `tough-cookie` installed)
- Any `Set-Cookie` headers received
- The raw HTML response (if status is 2xx and content-type is HTML)

## How comparison works
1) The tool extracts the `#dropmenu` element. If missing in A or B, the pair fails.
2) It parses the inner HTML and collects the text content of all `a` tags.
3) Text is whitespace-normalized and joined with newlines.
4) It diffs these two anchor lists. This reduces noise from formatting/markup.

Pass/Fail:
- PASS: Identical anchor text lists
- FAIL: Shows “Anchor counts: A=X, B=Y” and a textual diff

## Output
- Results table: shows pair index, only the request-target (path + query + hash) for URLs, and status.
- For failures with diffs, the tool prints a unified diff. Use `--full-diff` to see the entire diff.
- Summary at the end: total, pass, fail. Exit code is non-zero if any failures.

## Troubleshooting
- Status `0`: no HTTP response (timeout, DNS/TLS/socket). Increase `--timeout`, check `--referer` / cookies.
- If A passes but B fails: ensure `cookies.txt` line 2 contains the right cookies for B.
- Some servers require a same-site `Referer`. Use `--referer-b` accordingly.
- To better emulate browser cookie behavior across redirects, install `tough-cookie`.

## License
MIT


