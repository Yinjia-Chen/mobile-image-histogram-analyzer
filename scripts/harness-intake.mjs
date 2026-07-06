#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ROUTEBOOK = '.agent/routebook/task-types.json';
const REQUEST_FILE = '.agent/tmp/latest-request.md';
const WORK_ORDER_FILE = '.agent/tmp/current-work-order.md';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { text: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--text') {
      args.text = argv[index + 1] || '';
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: npm run harness:intake -- --text "<request>"');
      process.exit(0);
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function readRequest(args) {
  if (args.text !== null) return args.text.trim();
  if (!fs.existsSync(REQUEST_FILE)) {
    fail(`No request text found. Pass --text or create ${REQUEST_FILE}.`);
  }
  const text = fs.readFileSync(REQUEST_FILE, 'utf8').trim();
  if (!text) fail(`Request file is empty: ${REQUEST_FILE}`);
  return text;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, filePath), 'utf8'));
  } catch (error) {
    fail(`Cannot read ${filePath}: ${error.message}`);
  }
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  } catch {
    return '';
  }
}

function changedFiles() {
  return [
    git(['diff', '--name-only']),
    git(['diff', '--cached', '--name-only']),
    git(['ls-files', '--others', '--exclude-standard']),
  ]
    .join('\n')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

function includesSignal(text, signal) {
  return text.toLowerCase().includes(String(signal).toLowerCase());
}

function scoreLane(request, files, lane) {
  const requestMatches = (lane.signals || []).filter((signal) => includesSignal(request, signal));
  const fileMatches = (lane.fileSignals || []).filter((signal) =>
    files.some((file) => includesSignal(file, signal)),
  );
  return {
    score: requestMatches.length * 3 + fileMatches.length,
    requestMatches,
    fileMatches,
  };
}

function selectLane(request, files, routebook) {
  const lanes = routebook.lanes || {};
  const scored = Object.entries(lanes)
    .map(([name, lane]) => ({ name, lane, ...scoreLane(request, files, lane) }))
    .filter((item) => item.name !== routebook.defaultLane);

  scored.sort((a, b) => b.score - a.score);
  const winner = scored[0];
  if (winner && winner.score > 0) {
    return {
      primary: winner,
      supporting: scored
        .filter((item) => item.name !== winner.name && item.score > 0)
        .slice(0, 2),
    };
  }

  const fallbackName = routebook.defaultLane || 'general_project';
  return {
    primary: {
      name: fallbackName,
      lane: lanes[fallbackName] || {},
      score: 0,
      requestMatches: [],
      fileMatches: [],
    },
    supporting: [],
  };
}

function list(items, empty = 'None') {
  if (!items || items.length === 0) return empty;
  return items.map((item) => `- ${item}`).join('\n');
}

function existing(items) {
  return (items || []).filter((item) => fs.existsSync(path.join(ROOT, item)));
}

function unique(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const request = readRequest(args);
  const routebook = readJson(ROUTEBOOK);
  const files = changedFiles();
  const selected = selectLane(request, files, routebook);
  const primary = selected.primary;
  const supporting = selected.supporting;
  const participatingLanes = [primary, ...supporting];
  const lane = primary.lane;
  const skills = existing(unique([
    ...(primary.lane.skills || []),
    ...supporting.map((item) => (item.lane.skills || [])[0]),
  ]));
  const cases = existing(unique(participatingLanes.flatMap((item) => item.lane.cases || [])));
  const inspect = unique(participatingLanes.flatMap((item) => item.lane.inspect || []));
  const proof = unique(participatingLanes.flatMap((item) => item.lane.proof || []));

  const content = `# Histogram Delivery Work Order

## Raw Request

${request}

## Delivery Lane

Primary: ${primary.name}

${lane.description || 'No lane description.'}

Supporting lanes:
${list(supporting.map((item) => `${item.name}: ${item.lane.description || 'No description.'}`))}

## Match Evidence

Request signals:
${list(primary.requestMatches)}

Changed-file signals:
${list(primary.fileMatches)}

Supporting lane signals:
${list(supporting.map((item) => `${item.name}: ${[...item.requestMatches, ...item.fileMatches].join(', ')}`))}

Changed files:
${list(files, 'No changed files detected.')}

## Skills To Read

${list(skills)}

## Cases To Read

${list(cases)}

## Context To Inspect

${list(inspect)}

## Proof Needed

${list(proof)}

## Scope Reminder

- Keep the project centered on an offline Android WebView APK.
- Preserve the required grayscale formula and 256x100 histogram semantics.
- Do not introduce backend scope unless explicitly requested.
`;

  fs.mkdirSync(path.dirname(WORK_ORDER_FILE), { recursive: true });
  fs.writeFileSync(WORK_ORDER_FILE, content, 'utf8');

  console.log(`Work order written to ${WORK_ORDER_FILE}`);
  console.log(`Primary lane: ${primary.name}`);
  if (supporting.length) console.log(`Supporting lanes: ${supporting.map((item) => item.name).join(', ')}`);
  console.log(`Skills: ${skills.length ? skills.join(', ') : 'None'}`);
}

main();
