const chalk = require('chalk');
const { requestTarget } = require('./url');

function printSummary({ total, pass, fail }) {
  const status = fail === 0 ? chalk.bgGreen.black(' ALL PASS ') : chalk.bgRed.white(' SOME FAIL ');
  console.log(status + ' ' + chalk.bold(`Summary: ${pass} passed, ${fail} failed (total ${total})`));
}

function printFailureDiff(result, { full = false } = {}) {
  const header = `${chalk.bgRed.white(' FAIL ')} ${chalk.bold('Difference for pair #' + result.index)}\n` +
    chalk.gray(requestTarget(result.urlA)) + '  vs  ' + chalk.gray(requestTarget(result.urlB));
  console.log('\n' + header);
  const lines = result.diff.split(/\r?\n/);
  const max = full ? lines.length : Math.min(lines.length, 200); // ~first 200 lines by default
  for (let i = 0; i < max; i++) {
    const line = lines[i];
    if (line.startsWith('+')) console.log(chalk.green(line));
    else if (line.startsWith('-')) console.log(chalk.red(line));
    else if (line.startsWith('@@')) console.log(chalk.cyan(line));
    else console.log(line);
  }
  if (!full && lines.length > max) {
    console.log(chalk.gray(`... (${lines.length - max} more lines, re-run with --full-diff to see all)`));
  }
}

module.exports = { printSummary, printFailureDiff };