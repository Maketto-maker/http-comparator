const he = require('he');

module.exports = function normalizeHtml(input) {
  if (!input) return '';
  let s = String(input);
  // Remove HTML comments
  s = s.replace(/<!--([\s\S]*?)-->/g, '');
  // Decode entities where safe
  try { s = he.decode(s); } catch (_) {}
  // Collapse whitespace
  s = s.replace(/\s+/g, ' ');
  // Remove redundant whitespace between tags
  s = s.replace(/>\s+</g, '><');
  // Trim
  s = s.trim();
  return s;
};