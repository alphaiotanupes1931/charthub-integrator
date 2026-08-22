#!/usr/bin/env node
// Turns the JUnit files each CI shard uploads into a per-persona table for the
// GitHub job summary. Failures are printed with their full suite path, so a
// regression reads as "persona: free > locks /autopilot [autopilot]".
//
// Usage: node scripts/junit-summary.mjs <dir-with-xml-files>

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? "reports";

function xmlFiles(dir) {
  let out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out = out.concat(xmlFiles(p));
    else if (entry.endsWith(".xml")) out.push(p);
  }
  return out;
}

const unescape = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? unescape(m[1]) : "";
};

const groups = new Map(); // label -> { total, failed, skipped, time, failures[] }
let files = [];
try {
  files = xmlFiles(root);
} catch {
  console.log(`No JUnit reports found under \`${root}\`.`);
  process.exit(0);
}

for (const file of files) {
  const xml = readFileSync(file, "utf8");
  for (const [, tag, body] of xml.matchAll(/<testcase\b([^>]*)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const classname = attr(tag, "classname");
    const name = attr(tag, "name");
    const time = Number(attr(tag, "time") || 0);
    const failed = /<(failure|error)\b/.test(body ?? "");
    const skipped = /<skipped\b/.test(body ?? "");

    const persona = (classname + " " + name).match(/persona:\s*([A-Za-z]+)/);
    const label = persona ? `persona: ${persona[1]}` : (classname.split(" > ")[0] || "other");

    const g = groups.get(label) ?? { total: 0, failed: 0, skipped: 0, time: 0, failures: [] };
    g.total++;
    g.time += time;
    if (failed) {
      g.failed++;
      g.failures.push(`${classname} > ${name}`);
    }
    if (skipped) g.skipped++;
    groups.set(label, g);
  }
}

if (groups.size === 0) {
  console.log(`No test cases parsed from \`${root}\`.`);
  process.exit(0);
}

const rows = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
const totals = rows.reduce(
  (acc, [, g]) => ({ total: acc.total + g.total, failed: acc.failed + g.failed }),
  { total: 0, failed: 0 },
);

console.log("## Access matrix\n");
console.log(
  totals.failed === 0
    ? `All **${totals.total}** checks passed across ${rows.length} groups.\n`
    : `**${totals.failed}** of **${totals.total}** checks failed.\n`,
);
console.log("| Group | Checks | Failed | Skipped | Time |");
console.log("| --- | --- | --- | --- | --- |");
for (const [label, g] of rows) {
  console.log(
    `| ${g.failed ? "FAIL" : "pass"} ${label} | ${g.total} | ${g.failed} | ${g.skipped} | ${g.time.toFixed(2)}s |`,
  );
}

const failing = rows.filter(([, g]) => g.failures.length);
if (failing.length) {
  console.log("\n### Failures\n");
  for (const [label, g] of failing) {
    console.log(`**${label}**\n`);
    for (const f of g.failures) console.log(`- \`${f}\``);
    console.log("");
  }
}

process.exit(totals.failed === 0 ? 0 : 1);
