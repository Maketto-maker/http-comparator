const cheerio = require('cheerio');

module.exports = function extractMenu(html) {
  try {
    const $ = cheerio.load(html, { decodeEntities: true, xmlMode: false });
    const el = $('#dropmenu').first();
    if (!el || el.length === 0) {
      return { missing: true, html: '' };
    }
    // inner HTML (not including the wrapper itself)
    const inner = el.html() || '';
    return { missing: false, html: inner };
  } catch (e) {
    return { missing: true, html: '' };
  }
};