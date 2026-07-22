// Nearcast-specific structured contracts for Operon. Weather calculations stay
// in application code; these contracts only allow the model to extract intent
// and phrase facts that Nearcast has already computed.

export const SUMMARY_OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    summary: { type: "string" }
  },
  required: ["summary"],
  additionalProperties: false
});

export const PLAN_INTENT_OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    activity: { type: "string" },
    day: { type: "string" },
    time: { type: "string" },
    location: { type: "string" }
  },
  required: ["activity", "day", "time", "location"],
  additionalProperties: false
});

const EXAMPLE_FACTS =
  "Place: Austin, Texas. Local time 7:10am, daytime.\n" +
  "Right now: 58°F, feels like 56°F, partly cloudy. Wind 6 mph from the S. Humidity 72%.\n" +
  "Next 2 hours: dry.\n" +
  "Rest of today: high 88°F, low 57°F, 20% chance of rain. UV index peaks at 8. Sunset 8:14pm.\n" +
  "Tomorrow: partly cloudy, high 90°F, low 60°F, 10% chance of rain.\n" +
  "No active weather alerts.";

const EXAMPLE_SUMMARY =
  "A cool, partly cloudy start near 58° warms fast to a summery high of 88°, staying mostly dry. " +
  "Get outdoor plans in early — the midday UV hits an 8, so keep sunscreen handy this afternoon.";

export function summaryQuery() {
  return (
    "Write a Nearcast weather summary using only source S1. The output.summary value must be " +
    "exactly two natural sentences and no more than 45 words. Sentence one says what to expect; " +
    "sentence two gives one practical tip. Never invent, calculate, or alter a number. Do not use " +
    "a greeting, list, or markdown. The top-level answer may repeat the summary and cite [S1].\n\n" +
    `STYLE EXAMPLE FACTS:\n${EXAMPLE_FACTS}\n\nSTYLE EXAMPLE SUMMARY:\n${EXAMPLE_SUMMARY}`
  );
}

export function planIntentQuery(message) {
  const input = String(message || "").slice(0, 220);
  return (
    "Extract the outdoor plan from USER MESSAGE into output.activity, output.day, output.time, " +
    "and output.location. Copy only exact words that appear in USER MESSAGE. Use an empty string " +
    "for a missing field. Do not answer a weather question, infer a forecast, normalize a date, " +
    "or invent details. The top-level answer should briefly say that the plan fields were extracted.\n\n" +
    `USER MESSAGE:\n${input}`
  );
}

export function summarySource(factSheet) {
  return {
    id: "S1",
    path: "nearcast://current-weather-facts",
    text: String(factSheet || ""),
    score: 1
  };
}

export function validateSummaryOutput(output, factSheet) {
  const summary = String(output?.summary || "").trim();
  const errors = [];
  if (!summary) return ["output.summary must be a non-empty string"];

  const words = summary.match(/\S+/g) || [];
  if (words.length > 45) errors.push("output.summary must contain no more than 45 words");

  const sentences = summary.match(/[^.!?]+[.!?]+(?:[\"'”’)]*)/g) || [];
  if (sentences.length !== 2 || sentences.join(" ").replace(/\s+/g, " ").trim() !== summary.replace(/\s+/g, " ").trim()) {
    errors.push("output.summary must contain exactly two complete sentences");
  }
  if (/^\s*(?:hello|hi|hey|greetings)\b/i.test(summary)) {
    errors.push("output.summary must not contain a greeting");
  }
  if (/(?:^|\n)\s*(?:[-*#]|\d+[.)])\s/.test(summary)) {
    errors.push("output.summary must not contain a list or markdown");
  }

  const allowedNumbers = new Set((String(factSheet || "").match(/\d+(?:\.\d+)?/g) || []));
  const generatedNumbers = summary.match(/\d+(?:\.\d+)?/g) || [];
  for (const value of generatedNumbers) {
    if (!allowedNumbers.has(value)) errors.push(`output.summary invented or altered number ${value}`);
  }
  return [...new Set(errors)];
}

export function validatePlanIntentOutput(output, message) {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return ["output must be an object"];
  }
  const source = String(message || "").toLocaleLowerCase();
  const errors = [];
  for (const key of ["activity", "day", "time", "location"]) {
    if (typeof output[key] !== "string") {
      errors.push(`output.${key} must be a string`);
      continue;
    }
    const value = output[key].trim().toLocaleLowerCase();
    if (value && !source.includes(value)) {
      errors.push(`output.${key} must copy exact words from the user message`);
    }
  }
  return errors;
}

export function outputFromOperonResult(result) {
  return result?.output && typeof result.output === "object" ? result.output : null;
}
