const { createTwoFilesPatch } = require('diff');

function compareStrings(a, b) {
  if (a === b) return { equal: true, diff: '' };
  const patch = createTwoFilesPatch('menu-old', 'menu-new', a + '\n', b + '\n', '', '', { context: 2 });
  return { equal: false, diff: patch };
}

module.exports = { compareStrings };