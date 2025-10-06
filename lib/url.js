function requestTarget(input) {
  if (!input) return '';
  try {
    const url = new URL(String(input));
    const pathname = url.pathname || '/';
    const search = url.search || '';
    const hash = url.hash || '';
    return `${pathname}${search}${hash}`;
  } catch (_) {
    // Fallback: if not a valid absolute URL, return as-is
    return String(input);
  }
}

module.exports = { requestTarget };


