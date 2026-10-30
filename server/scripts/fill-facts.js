// Fills the website facts of the whole library at once, instead of a few links every 15 minutes.
// The facts that need the AI (who runs it, price plans, features) can be answered by Claude instead of the free AI,
// whose daily limit would make the first fill take weeks:
//
//   1. FACTS_AI=record node --env-file=.env server/scripts/fill-facts.js all
//      saves every fact that needs no AI, and writes the AI's questions to .data/facts-ai/questions.jsonl
//   2. Claude answers them into .data/facts-ai/answers-*.jsonl, one {"key", "answer"} per line
//   3. FACTS_AI=replay node --env-file=.env server/scripts/fill-facts.js ai
//      saves Claude's answers the normal way (history, trust grade and all)
//
// Without FACTS_AI, "ai" asks the free AI as usual. YouTube is left out: Google allows about 80 links a day.
// AT_ONCE (default 10) is how many links are checked at the same time.
import { loadKinds, runFacts } from '../facts/runner.js';

const step = process.argv[2];
if (!['all', 'free', 'ai'].includes(step)) {
  console.error('Say which facts: all, free (no AI) or ai.');
  process.exit(1);
}

const kinds = (await loadKinds()).filter(kind => kind.kind !== 'youtube');
const only = kinds.filter(kind => step === 'all' || (step === 'ai') === Boolean(kind.ai)).map(kind => kind.kind);
console.log(`Filling ${only.join(', ')}${process.env.FACTS_AI ? ` (AI: ${process.env.FACTS_AI})` : ''}…`);

const started = Date.now();
const result = await runFacts({ budgetMs: 4 * 3600_000, only, perRun: 100_000, atOnce: Number(process.env.AT_ONCE) || 10 });
console.log(`Done in ${Math.round((Date.now() - started) / 60_000)} min:`, JSON.stringify(result.byKind));
process.exit(0);
