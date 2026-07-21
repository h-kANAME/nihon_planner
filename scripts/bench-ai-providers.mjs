/**
 * Bench interno: efectividad Google (Gemini) vs DeepSeek sobre docs/plan.example.md.
 *
 * Uso:
 *   node scripts/bench-ai-providers.mjs
 *   node scripts/bench-ai-providers.mjs --providers=google --model=gemini-3-flash-preview
 *   node scripts/bench-ai-providers.mjs --providers=google --model=gemini-3-flash-preview --reuse=docs/ai-provider-bench.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAIProvider } from "../server/ai/provider.mjs";
import { buildAiConfig, resolveAiApiKey } from "../server/config.mjs";
import { convertMarkdownToItinerary, splitMarkdownByDays } from "../server/itinerary/convert.mjs";
import { augmentChunksWithSummaryDays } from "../server/itinerary/summaryDays.mjs";
import { scoreItineraryEffectiveness } from "../server/itinerary/effectiveness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

/** USD / 1M tokens (paid tier, texto). Fuentes: ai.google.dev/gemini-api/docs/pricing */
const PRICE_PER_M = {
  "gemini-flash-lite-latest": { in: 0.25, out: 1.5 },
  "gemini-3.1-flash-lite": { in: 0.25, out: 1.5 },
  "gemini-2.5-flash-lite": { in: 0.1, out: 0.4 },
  "gemini-3-flash-preview": { in: 0.5, out: 3.0 },
  "gemini-flash-latest": { in: 0.5, out: 3.0 },
  "gemini-3.5-flash": { in: 1.5, out: 9.0 },
  "gemini-2.5-flash": { in: 0.3, out: 2.5 },
  "deepseek-chat": { in: 0.28, out: 0.42 },
};

function priceFor(model) {
  if (PRICE_PER_M[model]) return PRICE_PER_M[model];
  if (/lite/i.test(model)) return { in: 0.25, out: 1.5 };
  if (/pro/i.test(model)) return { in: 2.0, out: 12.0 };
  if (/flash/i.test(model)) return { in: 0.5, out: 3.0 };
  return { in: 0.5, out: 3.0 };
}

function estimateUsd(model, tokensIn, tokensOut) {
  const p = priceFor(model);
  const usd = (tokensIn / 1e6) * p.in + (tokensOut / 1e6) * p.out;
  return {
    usd: Math.round(usd * 1e6) / 1e6,
    priceInPerM: p.in,
    priceOutPerM: p.out,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
  };
}

function loadDotEnv() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function flagValue(argv, name) {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length) : null;
}

function parseProviders(argv) {
  const raw = flagValue(argv, "providers") || "deepseek,google";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((p) => (p === "gemini" ? "google" : p));
}

function expectedDayCount(markdown) {
  const { chunks: heading } = splitMarkdownByDays(markdown);
  const chunks = augmentChunksWithSummaryDays(markdown, heading);
  const nums = new Set(chunks.map((c) => c.dayNumber).filter((n) => n != null));
  return Math.max(nums.size, 1);
}

function consoleLog(...args) {
  // eslint-disable-next-line no-console
  console.log(...args);
}

function wrapAiWithUsage(ai) {
  let tokensIn = 0;
  let tokensOut = 0;
  const add = (usage) => {
    if (typeof usage?.tokens_in === "number") tokensIn += usage.tokens_in;
    if (typeof usage?.tokens_out === "number") tokensOut += usage.tokens_out;
  };
  return {
    ai: {
      provider: ai.provider,
      chat: async (args) => {
        const r = await ai.chat(args);
        add(r.usage);
        return r;
      },
      chatComplete: async (args) => {
        const r = await ai.chatComplete(args);
        add(r.usage);
        return r;
      },
    },
    getUsage: () => ({ tokens_in: tokensIn, tokens_out: tokensOut }),
  };
}

async function runOne(provider, markdown, expectedDays, { model } = {}) {
  const cfg = buildAiConfig(provider, process.env, model ? { aiModel: model } : {});
  if (!cfg.aiApiKey) {
    return {
      provider,
      skipped: true,
      reason: `Sin API key para ${provider} (revisá GEMINI_API_KEY / DEEPSEEK_API_KEY / AI_API_KEY)`,
    };
  }

  const base = createAIProvider(cfg);
  const { ai, getUsage } = wrapAiWithUsage(base);
  const t0 = Date.now();
  const label = `${provider}:${cfg.aiModel}`;
  const log = {
    info: (obj, msg) => consoleLog(`[${label}]`, msg || "", typeof obj === "object" ? JSON.stringify(obj) : obj),
    warn: (obj, msg) => consoleLog(`[${label}:warn]`, msg || "", typeof obj === "object" ? JSON.stringify(obj) : obj),
  };

  try {
    const converted = await convertMarkdownToItinerary(ai, markdown, { log });
    const elapsedMs = Date.now() - t0;
    const usage = getUsage();
    const cost = estimateUsd(cfg.aiModel, usage.tokens_in, usage.tokens_out);
    const score = scoreItineraryEffectiveness(converted.data, {
      expectedDays,
      warnings: converted.warnings,
      strategy: converted.meta?.strategy,
    });
    return {
      provider,
      model: cfg.aiModel,
      skipped: false,
      elapsedMs,
      score,
      warnings: converted.warnings,
      meta: converted.meta,
      usage,
      cost,
      sample: {
        title: converted.data.title,
        anchor_date: converted.data.anchor_date,
        dayNumbers: converted.data.days.map((d) => d.day_number),
      },
    };
  } catch (e) {
    const usage = getUsage();
    return {
      provider,
      model: cfg.aiModel,
      skipped: false,
      error: e.message || String(e),
      elapsedMs: Date.now() - t0,
      usage,
      cost: estimateUsd(cfg.aiModel, usage.tokens_in, usage.tokens_out),
    };
  }
}

/**
 * Corrida Lite previa sin usage API: estima output por chars de log conocidos
 * y reusa tokens_in medidos de la corrida Flash (mismo MD / mismo pipeline).
 */
function attachLiteCostEstimate(liteResult, flashTokensIn) {
  // Suma de chars de salida de la corrida lite exitosa (meta + 10 refine).
  const outChars =
    59 + 2868 + 3122 + 2782 + 2566 + 3801 + 3192 + 3439 + 2910 + 2551 + 2622;
  const tokensOutEst = Math.round(outChars / 4);
  const tokensIn = Number.isFinite(flashTokensIn) ? flashTokensIn : 0;
  const cost = estimateUsd(liteResult.model, tokensIn, tokensOutEst);
  return {
    ...liteResult,
    usage: {
      tokens_in: tokensIn,
      tokens_out: tokensOutEst,
      estimated: true,
      note: "tokens_in ≈ corrida Flash (mismo MD); tokens_out estimado por chars de la corrida Lite",
    },
    cost: { ...cost, estimated: true },
  };
}

function formatReport(results, expectedDays) {
  const lines = [];
  lines.push("# Bench AI providers — efectividad import híbrido");
  lines.push("");
  lines.push(`- Fuente: \`docs/plan.example.md\``);
  lines.push(`- Días esperados: **${expectedDays}**`);
  lines.push(`- Generado: ${new Date().toISOString()}`);
  lines.push("");
  lines.push(
    "| Modelo | Global | Cobertura | Estructura | Títulos | Fidelidad | Ancla | Robustez | Tiempo | Tokens in/out | USD |",
  );
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");

  for (const r of results) {
    if (r.skipped) {
      lines.push(`| ${r.provider} | skip | — | — | — | — | — | — | — | — | — |`);
      continue;
    }
    if (r.error) {
      lines.push(`| ${r.model || r.provider} | ERROR | — | — | — | — | — | — | — | — | ${r.error} |`);
      continue;
    }
    const d = r.score.dimensions;
    const sec = `${Math.round(r.elapsedMs / 1000)}s`;
    const tin = r.usage?.tokens_in ?? "—";
    const tout = r.usage?.tokens_out ?? "—";
    const usd =
      r.cost?.usd != null
        ? `$${r.cost.usd.toFixed(4)}${r.cost.estimated ? "*" : ""}`
        : "—";
    lines.push(
      `| ${r.model} | **${r.score.global}%** | ${d.coverage}% | ${d.structure}% | ${d.titles}% | ${d.fidelity}% | ${d.anchor}% | ${d.robustness}% | ${sec} | ${tin}/${tout} | ${usd} |`,
    );
  }

  const ok = results.filter((r) => r.score?.global != null);
  if (ok.length >= 2) {
    const sorted = [...ok].sort((a, b) => b.score.global - a.score.global);
    lines.push("");
    lines.push("## Veredicto");
    lines.push("");
    lines.push(
      `Mejor score: **${sorted[0].model}** (${sorted[0].score.global}%) vs **${sorted[1].model}** (${sorted[1].score.global}%).`,
    );
    const delta = round1(sorted[0].score.global - sorted[1].score.global);
    lines.push(`Diferencia: **${delta} pp**.`);
    if (sorted[0].cost?.usd != null && sorted[1].cost?.usd != null) {
      const cheaper = [...ok].sort((a, b) => (a.cost?.usd ?? 99) - (b.cost?.usd ?? 99));
      lines.push(
        `Costo: **${cheaper[0].model}** $${cheaper[0].cost.usd.toFixed(4)} vs **${cheaper[1].model}** $${cheaper[1].cost.usd.toFixed(4)}.`,
      );
    }
  }

  lines.push("");
  lines.push("## Notas");
  lines.push("");
  lines.push("- El % global es el promedio de las 6 dimensiones (rúbrica del pipeline híbrido).");
  lines.push("- USD = (tokens_in/1M)*precio_in + (tokens_out/1M)*precio_out (paid tier Gemini).");
  lines.push("- `*` = costo estimado (Lite no re-ejecutada; input alineado a Flash).");
  lines.push("");
  return lines.join("\n");
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

async function main() {
  loadDotEnv();
  const argv = process.argv.slice(2);
  const providers = parseProviders(argv);
  const model = flagValue(argv, "model");
  const reusePath = flagValue(argv, "reuse");
  const mdPath = path.join(root, "docs", "plan.example.md");
  const markdown = fs.readFileSync(mdPath, "utf8");
  const expectedDays = expectedDayCount(markdown);

  consoleLog(`Bench providers=${providers.join(",")} model=${model || "(default)"} expectedDays=${expectedDays}`);
  for (const p of providers) {
    const has = Boolean(resolveAiApiKey(p));
    consoleLog(`  key ${p}: ${has ? "ok" : "MISSING"}`);
  }

  const results = [];
  for (const p of providers) {
    consoleLog(`\n=== ${p}${model ? ` (${model})` : ""} ===`);
    const r = await runOne(p, markdown, expectedDays, { model });
    results.push(r);
    if (r.skipped) consoleLog("SKIP:", r.reason);
    else if (r.error) consoleLog("ERROR:", r.error);
    else {
      consoleLog(
        `DONE global=${r.score.global}% stops=${r.score.stats.stops} warnings=${r.score.stats.warnings} usd=$${r.cost.usd.toFixed(4)} tokens=${r.usage.tokens_in}/${r.usage.tokens_out}`,
      );
    }
  }

  let merged = results;
  if (reusePath) {
    const abs = path.isAbsolute(reusePath) ? reusePath : path.join(root, reusePath);
    if (fs.existsSync(abs)) {
      const prev = JSON.parse(fs.readFileSync(abs, "utf8"));
      const flash = results.find((r) => r.score && /flash/i.test(r.model || "") && !/lite/i.test(r.model || ""));
      const litePrev = (prev.results || []).find((r) => /lite/i.test(r.model || "") && r.score);
      const kept = [];
      if (litePrev) {
        kept.push(attachLiteCostEstimate(litePrev, flash?.usage?.tokens_in));
      }
      merged = [...kept, ...results];
      consoleLog(`Reused ${kept.length} result(s) from ${reusePath}`);
    }
  }

  const report = formatReport(merged, expectedDays);
  const outDir = path.join(root, "docs");
  const reportPath = path.join(outDir, "ai-provider-bench.md");
  const jsonPath = path.join(outDir, "ai-provider-bench.json");
  fs.writeFileSync(reportPath, report);
  fs.writeFileSync(
    jsonPath,
    JSON.stringify({ expectedDays, results: merged, generated_at: new Date().toISOString() }, null, 2),
  );
  consoleLog("\n" + report);
  consoleLog(`\nWrote ${reportPath}`);
  consoleLog(`Wrote ${jsonPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
