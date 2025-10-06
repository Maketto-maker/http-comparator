const cheerio = require('cheerio');

function extractAnchorTexts(html) {
  if (!html) return [];
  try {
    const $ = cheerio.load(html, { decodeEntities: true, xmlMode: false });
    const texts = [];
    $('a').each((_, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      if (text) texts.push(text);
    });
    return texts;
  } catch (_) {
    return [];
  }
}

module.exports = { extractAnchorTexts };


