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

export function summaryQuery() {
  return (
    "Write a Nearcast weather summary using only source S1. The output.summary value must be " +
    "one or two natural sentences and no more than forty-five words. Say what to expect and, when " +
    "useful, give one practical tip. Never invent, calculate, or alter a number. Do not use " +
    "a greeting, list, markdown, or citation inside output.summary. There are no example weather " +
    "facts in this instruction: every condition, number, time, and recommendation must be supported " +
    "by S1. The top-level answer may repeat the summary and cite [S1]."
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

  if (!/[.!?][\"'”’)]*$/.test(summary)) {
    errors.push("output.summary must end as a complete sentence");
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
