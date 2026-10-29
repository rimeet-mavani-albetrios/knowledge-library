// "Is it right for me?": the free AI reads what the library knows about one website and what you need, and answers
// with a score from 0 to 10, a one-line verdict, the reasons, and one thing to watch out for.
import { chat } from '../robot/ai.js';
import { hostOf } from '../robot/url.js';

const clean = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const COUNTRY = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = code => {
  try {
    return code ? COUNTRY.of(code) : '';
  } catch {
    return code;
  }
};

export async function fitWithAi(link, facts, need) {
  const company = facts.company ?? {};
  const wiki = facts.wikidata ?? {};
  const known = [
    `Name: ${link.title} (${link.source === 'github' ? 'GitHub' : hostOf(link.url)})`,
    `Price: ${link.pricing}`,
    link.level && `Skill level: ${link.level}`,
    link.summary && `Summary: ${link.summary}`,
    link.useFor && `Use it for: ${link.useFor}`,
    link.audience && `Who it's for: ${link.audience}`,
    link.tasks?.length && `Can do: ${link.tasks.join('; ')}`,
    link.features?.length && `Key features: ${link.features.join('; ')}`,
    link.github && `GitHub: ${link.github.stars} stars, license ${link.github.license ?? 'none'}`,
    (company.name || wiki.name) && `Company: ${company.name || wiki.name}${company.country || wiki.country ? `, ${countryName(company.country || wiki.country)}` : ''}`,
    company.dataRegion && `Data stored in: ${company.dataRegion === 'EU' ? 'the EU' : countryName(company.dataRegion)}`,
    facts.trust && `Trust grade: ${facts.trust.grade}`,
    facts.app?.ios?.rating && `iPhone app: ${facts.app.ios.rating} stars from ${facts.app.ios.ratings} ratings`,
    facts.prices?.plans?.length && `Plans: ${facts.prices.plans.map(plan => `${plan.name} ${plan.price} ${plan.currency ?? ''}/${plan.period ?? ''}`).join('; ')}`,
    link.note && `The owner's note: ${clean(link.note).slice(0, 300)}`,
  ]
    .filter(Boolean)
    .join('\n');
  const response = await chat(
    [
      {
        role: 'system',
        content: 'You help someone decide if a tool from their own saved library fits what they need. Answer with one JSON object and nothing else. Write in simple, plain English with short sentences.',
      },
      {
        role: 'user',
        content: `What they need: "${need}"

What is known about the tool:
${known}

Return JSON with these keys:
- "score": a whole number from 0 (does not fit at all) to 10 (a perfect fit)
- "verdict": one short sentence with the answer
- "reasons": 2 or 3 short reasons, each under 15 words
- "watchOut": one short sentence about a limit or risk to check first, or "" if there is none

Use only the facts above. If they don't say enough, give a middle score and say what to check.`,
      },
    ],
    700,
  );
  const content = response.choices?.[0]?.message?.content ?? '';
  const answer = JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1));
  const score = Math.round(Number(answer.score));
  return {
    score: Number.isFinite(score) ? Math.min(10, Math.max(0, score)) : 5,
    verdict: clean(answer.verdict).slice(0, 300),
    reasons: (Array.isArray(answer.reasons) ? answer.reasons : []).map(clean).filter(Boolean).slice(0, 3).map(reason => reason.slice(0, 200)),
    watchOut: clean(answer.watchOut).slice(0, 300),
  };
}
