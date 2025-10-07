# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an HTTPS Menu Comparator - a Node.js CLI tool that compares the `#dropmenu` HTML content between two HTTPS URL versions by extracting and normalizing anchor text content. The tool is designed for quality assurance testing of menu consistency across different environments or versions.

## Architecture

### Core Components
- **index.js**: Main CLI entry point with argument parsing and orchestration
- **lib/fetch.js**: HTTP client with realistic browser headers, cookie support, and optional tough-cookie jar
- **lib/extract.js**: Cheerio-based HTML parser to extract `#dropmenu` element content
- **lib/anchors.js**: Specialized anchor text extraction with disabled element handling (`[DISABLED]` prefix)
- **lib/compare.js**: String diffing utilities for comparison results
- **lib/print.js**: Formatted output and diff visualization
- **lib/url.js**: URL utilities for request-target extraction

### Data Flow
1. Parse URL pairs from `urls.txt` and cookies from `cookies.txt`
2. Fetch both URLs with browser-like headers and appropriate cookies
3. Extract `#dropmenu` inner HTML from each response
4. Normalize anchor texts (including disabled state detection)
5. Compare normalized text lists and generate diffs
6. Output results table and detailed diffs for failures

## Development Commands

### Run the Tool
```bash
# Basic comparison
node index.js

# With custom files and options
node index.js --urls urls.txt --cookies cookies.txt --timeout 30000 --retries 2

# Debug mode (fetch single URL A and show raw HTML)
node index.js --debug --debug-index 1
```

### NPM Scripts
```bash
# Start the tool
npm start

# Test with sample files
npm run test:url
```

### Dependencies Management
```bash
# Install dependencies
npm install

# Optional enhanced cookie handling
npm install tough-cookie
```

## Key Configuration Files

### Input Files
- **urls.txt**: CSV format with URL pairs (`URL_A, URL_B`), supports comments with `#`
- **cookies.txt**: Line 1 for URL A cookies, Line 2 for URL B cookies (falls back to A if empty)

### Important CLI Options
- `--timeout <ms>`: HTTP request timeout (default 15000)
- `--retries <n>`: Automatic retry count for transient errors (default 0)
- `--delay <ms>`: Delay between URL pairs (default 1500)
- `--referer-a/--referer-b`: Set Referer headers (affects Sec-Fetch-Site calculation)
- `--full-diff`: Show complete diffs instead of truncated output
- `--insecure`: Allow insecure TLS connections
- `--follow-token-refresh`: Follow OAuth2 token refresh redirects automatically
- `--login-check`: Check login status and detect authentication requirements

## Code Patterns and Conventions

### HTTP Client Features
- Realistic Chromium browser User-Agent and headers
- Automatic Sec-Fetch-Site calculation based on referer vs target domain
- HTTP/2 support with connection reuse
- Optional tough-cookie jar for complex cookie scenarios
- Graceful fallback when tough-cookie is not installed
- **OAuth2 Token Refresh Support**: Automatically follows OAuth2/OIDC redirect chains when `--follow-token-refresh` is enabled
  - Detects authorization redirects (URLs with `/authorize`, `response_type`, `client_id`, `redirect_uri`)
  - Handles callback redirects (URLs with `/auth_callback` and `code` parameter)
  - Maintains proper Sec-Fetch-Site headers across domain boundaries
  - Preserves cookies throughout the authentication flow

### HTML Processing
- Uses Cheerio for server-side DOM manipulation
- Specifically targets `#dropmenu` element extraction
- Handles disabled menu items with `[DISABLED]` prefix
- Whitespace normalization and text content extraction
- Robust error handling for malformed HTML

### Comparison Logic
- Compares normalized anchor text lists (not raw HTML)
- Reduces noise from markup differences
- Unified diff output for failures
- Pass/fail based on exact text content match

### Authentication Detection
- **Login Status Checking**: `--login-check` mode tests authentication status
- Detects "Internal Server Error" responses
- Identifies common login requirement patterns:
  - "log in to market observer to continue to market observer"
  - "please log in", "login required", "authentication required"
- Reports failures as "FAIL (Require login)" vs "FAIL (Internal Server Error)"

## Error Handling

- Status `0`: Network/timeout issues - check connectivity, increase timeout, verify referer/cookies
- Missing `#dropmenu`: Indicates structural page differences
- Cookie-related failures: Ensure correct cookies in `cookies.txt` line 2 for URL B
- Referer requirements: Some servers require same-site referer headers