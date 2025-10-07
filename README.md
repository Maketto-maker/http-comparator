## HTTPS Menu Comparator

CLI tool to fetch two HTTPS pages, extract the `#dropmenu` contents, reduce noise by comparing the inner texts of all anchor tags, and report differences.

### What it does
- Fetches URL pairs (A vs B) from `urls.txt`
- Sends realistic browser-like headers; supports HTTP/2
- Uses separate cookies for A and B from `cookies.txt`
- **NEW: OAuth2 token refresh flow support** - automatically follows OAuth2 redirects and handles login forms
- **NEW: Automatic login** - can submit login credentials when login forms are detected
- **NEW: Login status checking** - dedicated mode to verify authentication status
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
- `credentials.txt`: **NEW** - login credentials for automatic authentication (line 1: A, line 2: B)

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

### credentials.txt (**NEW**)
- Line 1: Username and password for URL A (space-separated)
- Line 2: Username and password for URL B (space-separated, fallback to A if empty)

Example:
```text
user@example.com mypassword123
user2@example.com anotherpassword456
```

**Note**: Using credentials is highly recommended for applications requiring authentication.

## Usage

### Basic Workflow (**RECOMMENDED**)

1. **Set up cookies**: Copy-paste browser cookies into `cookies.txt`
2. **Verify authentication**: Run login-check mode first to ensure authentication works
3. **Run comparison**: Execute without `--login-check` for normal operation

```bash
# Step 1: Test authentication status (requires at least 3 URL pairs)
node index.js --login-check --cookies cookies.txt --urls urls.txt --credentials credentials.txt

# Step 2: If all tests pass, run normal comparison
node index.js --cookies cookies.txt --urls urls.txt --credentials credentials.txt
```

### Login Check Mode (**NEW**)

**IMPORTANT**: The `--login-check` mode requires **at least 3 records** in your URLs file for proper testing.

```bash
node index.js --login-check --cookies cookies.txt --urls urls.txt --credentials credentials.txt
```

This mode:
- Tests authentication status for each URL pair
- Provides verbose logging for debugging authentication issues
- Automatically handles OAuth2 token refresh flows
- Updates cookies file after successful OAuth2 flows
- Reports Internal Server Errors and login requirement issues

### Standard Comparison Mode

Run the comparator:
```bash
node index.js
```

Common flags:
- `--urls <path>`: path to `urls.txt` (default `urls.txt`)
- `--cookies <path>`: path to `cookies.txt` (default `cookies.txt`)
- `--credentials <path>`: **NEW** - path to `credentials.txt` for automatic login
- `--login-check`: **NEW** - enable login status checking mode (requires ≥3 URL pairs)
- `--follow-token-refresh`: **NEW** - follow OAuth2 token refresh redirects (default true)
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
# Basic run with credentials
node index.js --credentials credentials.txt

# Login check with verbose output
node index.js --login-check --cookies cookies.txt --urls urls.txt --credentials credentials.txt

# Increase timeout and enable two retries
node index.js --timeout=30000 --retries=2 --credentials credentials.txt

# Provide referer only for B
node index.js --referer-b="https://st-project.marketobserver.asia/" --credentials credentials.txt

# Show full diffs
node index.js --full-diff --credentials credentials.txt

# Disable OAuth2 token refresh (not recommended)
node index.js --follow-token-refresh=false --credentials credentials.txt
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

## Authentication and OAuth2 Support (**NEW**)

This tool now supports:

- **OAuth2 Token Refresh**: Automatically follows OAuth2 authorization redirects and handles token refresh flows
- **Automatic Login**: Detects login forms and submits credentials automatically when provided
- **Cookie Management**: Updates cookies file after successful OAuth2 flows to maintain session state
- **Login Status Verification**: `--login-check` mode provides detailed authentication status reporting

### OAuth2 Flow Handling

The tool automatically:
1. Detects OAuth2 authorization redirects
2. Follows up to 10 redirects (increased from 5)
3. Detects login forms containing "Log in to Market Observer"
4. Submits credentials automatically when provided
5. Handles callback URLs and token exchange
6. Updates cookies file with new session tokens

### Login Detection

The system can detect and handle:
- Internal Server Errors
- Login requirement messages ("log in to market observer to continue")
- Authentication required responses
- OAuth2 authorization flows

## Troubleshooting
- Status `0`: no HTTP response (timeout, DNS/TLS/socket). Increase `--timeout`, check `--referer` / cookies.
- If A passes but B fails: ensure `cookies.txt` line 2 contains the right cookies for B.
- Some servers require a same-site `Referer`. Use `--referer-b` accordingly.
- To better emulate browser cookie behavior across redirects, install `tough-cookie`.
- **Authentication failures**: Use `--login-check` mode first to debug authentication issues with verbose logging.
- **OAuth2 issues**: Check that credentials are correct and `--follow-token-refresh` is enabled (default).
- **Cookie expiration**: The tool automatically updates cookies after OAuth2 flows, but you may need to refresh initial cookies from browser.

## License
MIT


