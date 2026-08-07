import type { TestSummary } from "@portiq/core";

/** XML 1.0 forbids most control chars (allowed: tab, LF, CR); strip the rest. */
function stripControlChars(s: string): string {
  // eslint-disable-next-line no-control-regex -- intentionally stripping control chars
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function esc(s: unknown): string {
  return stripControlChars(String(s))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function testSummaryToJUnit(summary: TestSummary, suiteName: string): string {
  const cases: string[] = [];
  for (const g of summary.groups) {
    for (const e of g.entries) {
      const time = ((e.duration ?? 0) / 1000).toFixed(3);
      const base = `    <testcase classname="${esc(g.name)}" name="${esc(e.text)}" time="${time}"`;
      if (e.type === "pass") {
        cases.push(`${base}/>`);
      } else if (e.type === "fail") {
        cases.push(`${base}><failure message="${esc(e.errorMessage || "")}">${esc(e.errorType || "AssertionError")}</failure></testcase>`);
      } else if (e.type === "error") {
        cases.push(`${base}><error message="${esc(e.errorMessage || "")}">${esc(e.errorType || "Error")}</error></testcase>`);
      }
    }
  }
  const total = summary.passed + summary.failed + summary.errored;
  const time = (summary.duration / 1000).toFixed(3);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${total}" failures="${summary.failed}" errors="${summary.errored}" time="${time}">`,
    `  <testsuite name="${esc(suiteName)}" tests="${total}" failures="${summary.failed}" errors="${summary.errored}" time="${time}">`,
    ...cases,
    "  </testsuite>",
    "</testsuites>",
  ].join("\n");
}
