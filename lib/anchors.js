const cheerio = require('cheerio');

function extractAnchorTexts(html) {
  if (!html) return [];
  try {
    const $ = cheerio.load(html, { decodeEntities: true, xmlMode: false });
    const texts = [];
    
    // Extract disabled elements that contain anchor tags first
    $('li.disabled, .disabled').each((_, el) => {
      const $el = $(el);
      const $anchor = $el.find('a').first();
      if ($anchor.length > 0) {
        const text = $anchor.text().replace(/\s+/g, ' ').trim();
        if (text) {
          // Prefix with [DISABLED] to indicate the disabled state
          texts.push(`[DISABLED] ${text}`);
          // Mark this anchor as processed to avoid duplication
          $anchor.attr('data-processed', 'true');
        }
      }
    });
    
    // Extract regular anchor texts (excluding those already processed as disabled)
    $('a').each((_, el) => {
      const $el = $(el);
      if (!$el.attr('data-processed')) {
        const text = $el.text().replace(/\s+/g, ' ').trim();
        if (text) texts.push(text);
      }
    });
    
    return texts;
  } catch (_) {
    return [];
  }
}

module.exports = { extractAnchorTexts };


