#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const planner = await readFile(path.join(root, "planner.js"), "utf8");
const app = await readFile(path.join(root, "app.js"), "utf8");
const worker = await readFile(path.join(root, "workers/radar-capability.mjs"), "utf8");

assert.match(planner, /function agendaPlanWindow\([\s\S]*?continuous_span[\s\S]*?startDate:[\s\S]*?endDate:/, "continuous multi-day plans retain one start/end span for Agenda");
assert.match(planner, /function agendaPlanItems\([\s\S]*?refreshPlanRoutineOccurrences\(data\)[\s\S]*?startDate >= today && bounds\.startDate <= lastDate[\s\S]*?Number\(b\.active\) - Number\(a\.active\)/, "Agenda rolls weekly routines forward, caps the primary view at seven days, and puts active plans first");
assert.match(planner, /function agendaGroupLabel\([\s\S]*?"In progress"[\s\S]*?"Today"[\s\S]*?"Tomorrow"/, "Agenda uses the expected human date groups");
assert.match(planner, /function renderGlobalMemorySheet\([\s\S]*?agendaPlanItems[\s\S]*?agendaGroupLabel[\s\S]*?data-agenda-create/, "the Plans sheet renders the grouped agenda and keeps creation secondary");
assert.match(planner, /function renderPlanPulse\([\s\S]*?const agenda = agendaPlanItems[\s\S]*?laterChanged = agenda\.slice\(1\)\.find[\s\S]*?agenda-upcoming-change/, "a later forecast change remains discoverable without displacing Next up");
assert.match(app, /data-agenda-open[\s\S]*?openGlobalMemorySheet\(\{ source: "agenda" \}\)/, "the home peek opens the full Agenda");
assert.match(app, /data-agenda-plan[\s\S]*?recordForYouSignal\("agenda-plan-open"\)/, "opening a plan from Agenda records only an aggregate event");
assert.match(planner, /function recordPlanMemoryCreated\([\s\S]*?recordForYouSignal\("agenda-plan-created"\)/, "Agenda-originated plan creation is measured only after local save");
for (const event of ["agenda-open", "agenda-plan-open", "agenda-plan-created"]) {
  assert.ok(app.includes(`"${event}"`), `${event} is locally allowlisted`);
  assert.ok(worker.includes(`"${event}"`), `${event} is edge allowlisted`);
}
assert.doesNotMatch(planner.match(/function renderGlobalMemorySheet\([\s\S]*?\n\}/)?.[0] || "", /requestPlanWatchNotifications|setPlanWatchNotificationPlan/, "Agenda rendering never changes notification targets");

console.log("Agenda smoke passed.");
