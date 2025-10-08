const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { requestTarget } = require('./url');

// Convert chalk colors to HTML/CSS classes
function chalkToHtml(text) {
  return text
    // Background colors
    .replace(/\u001b\[41;37m([^\u001b]*)\u001b\[39;49m/g, '<span class="bg-red text-white">$1</span>') // bgRed.white
    .replace(/\u001b\[42;30m([^\u001b]*)\u001b\[39;49m/g, '<span class="bg-green text-black">$1</span>') // bgGreen.black
    .replace(/\u001b\[41m([^\u001b]*)\u001b\[49m/g, '<span class="bg-red">$1</span>') // bgRed
    .replace(/\u001b\[42m([^\u001b]*)\u001b\[49m/g, '<span class="bg-green">$1</span>') // bgGreen
    // Text colors
    .replace(/\u001b\[32m([^\u001b]*)\u001b\[39m/g, '<span class="text-green">$1</span>') // green
    .replace(/\u001b\[31m([^\u001b]*)\u001b\[39m/g, '<span class="text-red">$1</span>') // red
    .replace(/\u001b\[36m([^\u001b]*)\u001b\[39m/g, '<span class="text-cyan">$1</span>') // cyan
    .replace(/\u001b\[90m([^\u001b]*)\u001b\[39m/g, '<span class="text-gray">$1</span>') // gray
    .replace(/\u001b\[33m([^\u001b]*)\u001b\[39m/g, '<span class="text-yellow">$1</span>') // yellow
    .replace(/\u001b\[34m([^\u001b]*)\u001b\[39m/g, '<span class="text-blue">$1</span>') // blue
    // Bold text
    .replace(/\u001b\[1m([^\u001b]*)\u001b\[22m/g, '<strong>$1</strong>')
    // Clean up any remaining ANSI codes
    .replace(/\u001b\[[0-9;]*m/g, '');
}

function generateHtmlReport(results, summary, failures, metadata = {}) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const reportName = `${metadata.urls || 'urls'}-${metadata.cookies || 'cookies'}-${timestamp}`;

  // Generate summary section
  const summaryHtml = generateSummaryHtml(summary);

  // Generate results table
  const tableHtml = generateTableHtml(results);

  // Generate failure diffs
  const diffsHtml = generateDiffsHtml(failures, metadata.fullDiff || false);

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>HTTPS Menu Comparator Report - ${reportName}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            background-color: #1a1a1a;
            color: #e0e0e0;
            line-height: 1.6;
            padding: 20px;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
        }

        h1 {
            color: #ffffff;
            margin-bottom: 20px;
            font-size: 24px;
            border-bottom: 2px solid #333;
            padding-bottom: 10px;
        }

        h2 {
            color: #ffffff;
            margin: 30px 0 15px 0;
            font-size: 18px;
        }

        .metadata {
            background-color: #2a2a2a;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
            border-left: 4px solid #4a9eff;
        }

        .metadata p {
            margin: 5px 0;
        }

        .summary {
            margin-bottom: 30px;
            font-size: 16px;
            font-weight: bold;
        }

        .bg-red {
            background-color: #dc3545;
            color: white;
            padding: 2px 6px;
            border-radius: 3px;
        }

        .bg-green {
            background-color: #28a745;
            color: white;
            padding: 2px 6px;
            border-radius: 3px;
        }

        .text-white {
            color: white;
        }

        .text-black {
            color: black;
        }

        .text-green {
            color: #28a745;
        }

        .text-red {
            color: #dc3545;
        }

        .text-cyan {
            color: #17a2b8;
        }

        .text-gray {
            color: #6c757d;
        }

        .text-yellow {
            color: #ffc107;
        }

        .text-blue {
            color: #007bff;
        }

        .results-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 30px;
            background-color: #2a2a2a;
            border-radius: 5px;
            overflow: hidden;
        }

        .results-table th {
            background-color: #333;
            color: #e0e0e0;
            padding: 12px;
            text-align: left;
            font-weight: bold;
            border-bottom: 2px solid #444;
        }

        .results-table td {
            padding: 10px 12px;
            border-bottom: 1px solid #444;
            vertical-align: top;
        }

        .results-table tr:hover {
            background-color: #333;
        }

        .url-cell {
            max-width: 300px;
            word-break: break-all;
            font-size: 12px;
        }

        .index-cell {
            text-align: center;
            width: 50px;
        }

        .status-cell {
            text-align: center;
            width: 80px;
        }

        .failure-section {
            margin: 30px 0;
            background-color: #2a2a2a;
            border-radius: 5px;
            padding: 20px;
            border-left: 4px solid #dc3545;
        }

        .failure-header {
            margin-bottom: 15px;
            font-size: 16px;
            font-weight: bold;
        }

        .diff-content {
            background-color: #1a1a1a;
            padding: 15px;
            border-radius: 3px;
            font-size: 12px;
            line-height: 1.4;
            overflow-x: auto;
            white-space: pre-wrap;
            word-break: break-word;
        }

        .diff-line-add {
            color: #28a745;
        }

        .diff-line-remove {
            color: #dc3545;
        }

        .diff-line-context {
            color: #17a2b8;
        }

        .truncated-notice {
            color: #6c757d;
            font-style: italic;
            margin-top: 10px;
        }

        .no-failures {
            text-align: center;
            color: #28a745;
            font-size: 18px;
            margin: 40px 0;
        }

        .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #444;
            color: #6c757d;
            text-align: center;
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>HTTPS Menu Comparator Report</h1>

        <div class="metadata">
            <p><strong>Report Name:</strong> ${reportName}</p>
            <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
            <p><strong>URLs File:</strong> ${metadata.urls || 'urls.txt'}</p>
            <p><strong>Cookies File:</strong> ${metadata.cookies || 'cookies.txt'}</p>
            <p><strong>Total Comparisons:</strong> ${results.length}</p>
        </div>

        <div class="summary">
            ${summaryHtml}
        </div>

        <h2>Results Overview</h2>
        ${tableHtml}

        <h2>Failure Details</h2>
        ${diffsHtml}

        <div class="footer">
            Generated by HTTPS Menu Comparator v1.0<br>
            Report generated at ${new Date().toISOString()}
        </div>
    </div>
</body>
</html>`;

  return { content: htmlContent, filename: `${reportName}.html` };
}

function generateSummaryHtml(summary) {
  const status = summary.fail === 0 ?
    '<span class="bg-green text-white"> ALL PASS </span>' :
    '<span class="bg-red text-white"> SOME FAIL </span>';

  return `${status} <strong>Summary: ${summary.pass} passed, ${summary.fail} failed (total ${summary.total})</strong>`;
}

function generateTableHtml(results) {
  if (results.length === 0) {
    return '<p class="text-gray">No results to display.</p>';
  }

  let tableHtml = `
    <table class="results-table">
        <thead>
            <tr>
                <th class="index-cell">#</th>
                <th class="url-cell">URL A</th>
                <th class="url-cell">URL B</th>
                <th class="status-cell">Status</th>
            </tr>
        </thead>
        <tbody>
  `;

  for (const result of results) {
    const status = result.pass ?
      '<span class="bg-green text-white"> PASS </span>' :
      '<span class="bg-red text-white"> FAIL </span>';

    tableHtml += `
            <tr>
                <td class="index-cell">${result.index}</td>
                <td class="url-cell"><span class="text-cyan">${escapeHtml(requestTarget(result.urlA))}</span></td>
                <td class="url-cell"><span class="text-cyan">${escapeHtml(requestTarget(result.urlB))}</span></td>
                <td class="status-cell">${status}</td>
            </tr>
    `;
  }

  tableHtml += `
        </tbody>
    </table>
  `;

  return tableHtml;
}

function generateDiffsHtml(failures, fullDiff = false) {
  if (failures.length === 0) {
    return '<div class="no-failures">🎉 No failures to report - all comparisons passed!</div>';
  }

  let diffsHtml = '';

  for (const failure of failures) {
    const header = `<span class="bg-red text-white"> FAIL </span> <strong>Difference for pair #${failure.index}</strong><br>
                   <span class="text-gray">${escapeHtml(requestTarget(failure.urlA))}  vs  ${escapeHtml(requestTarget(failure.urlB))}</span>`;

    let diffContent = '';
    if (failure.diff) {
      const lines = failure.diff.split(/\r?\n/);
      const maxLines = fullDiff ? lines.length : Math.min(lines.length, 200);

      for (let i = 0; i < maxLines; i++) {
        const line = lines[i];
        let className = '';
        if (line.startsWith('+')) {
          className = 'diff-line-add';
        } else if (line.startsWith('-')) {
          className = 'diff-line-remove';
        } else if (line.startsWith('@@')) {
          className = 'diff-line-context';
        }

        diffContent += `<div class="${className}">${escapeHtml(line)}</div>`;
      }

      if (!fullDiff && lines.length > maxLines) {
        diffContent += `<div class="truncated-notice">... (${lines.length - maxLines} more lines, use --full-diff to see all)</div>`;
      }
    } else {
      diffContent = `<div class="text-gray">Reason: ${escapeHtml(failure.reason)}</div>`;
    }

    diffsHtml += `
      <div class="failure-section">
        <div class="failure-header">${header}</div>
        <div class="diff-content">${diffContent}</div>
      </div>
    `;
  }

  return diffsHtml;
}

function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function saveHtmlReport(results, summary, failures, metadata = {}) {
  const report = generateHtmlReport(results, summary, failures, metadata);
  const reportsDir = path.join(process.cwd(), 'reports');

  // Ensure reports directory exists
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const reportPath = path.join(reportsDir, report.filename);
  fs.writeFileSync(reportPath, report.content, 'utf8');

  return reportPath;
}

module.exports = {
  generateHtmlReport,
  saveHtmlReport,
  chalkToHtml
};