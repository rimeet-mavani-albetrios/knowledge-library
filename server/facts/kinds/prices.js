// Price watch: the plans on a website's pricing page, { plans: [{ name, price, currency, period }], url, upAt }.
// Checked every 30 days. The first check is only the starting point. After that, every plan whose price number
// changed adds a `price` row to the link's history, and a rise sets `upAt` (the "Price went up" chip and tag
// show for 30 days).
import { pageLinkOf, pathOf, readNow, around, askJson, clean, nameKey } from '../watch.js';

const MAX_TEXT = 3000; // letters of the pricing page the AI reads
const MAX_PLANS = 8;
const PERIODS = ['month', 'year', 'once', 'user/month', 'user/year'];
// The parts of a pricing page worth reading: amounts, "per month", "free", plan names.
const PRICEY = /[$€£₹¥]\s?\d|\d\s?(?:usd|eur|gbp|inr)\b|\/\s?(?:mo|month|yr|year|user|seat)\b|\bper (?:month|year|user|seat)\b|\bfree\b|\bplans?\b/i;

// The pricing page the robot found on the website, or the link itself when it is a pricing page.
// A paid or freemium website with no pricing page may show its prices on its own page.
function pricingPage(link) {
  if ((link.source ?? 'web') !== 'web') return '';
  const found = pageLinkOf(link, 'Pricing');
  if (found) return found;
  if (/\b(pricing|plans?|prices?)\b/i.test(pathOf(link.url))) return link.url;
  return ['paid', 'freemium'].includes(link.pricing) ? link.url : '';
}

const planKey = plan => `${nameKey(plan.name)}|${plan.period}`;

// 20, "20" and "$1,299.00" are prices; null, "Custom" and "Contact us" are not.
function toPrice(value) {
  const text = String(value ?? '');
  const number = typeof value === 'number' ? value : Number(text.replace(/[^\d.]/g, ''));
  return /\d/.test(text) && Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : null;
}

function cleanPlans(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map(plan => {
      const period = clean(plan?.period).toLowerCase();
      return {
        name: clean(plan?.name).slice(0, 40),
        price: toPrice(plan?.price),
        currency: /^[A-Za-z]{3}$/.test(clean(plan?.currency)) ? clean(plan.currency).toUpperCase() : '',
        period: PERIODS.includes(period) ? period : '',
      };
    })
    .filter(plan => plan.name && !seen.has(planKey(plan)) && seen.add(planKey(plan)))
    .slice(0, MAX_PLANS);
}

// The text right after each mention of a plan's name ("Pro … $25/mo + compute"), or the whole page when the name
// isn't written there as the AI gave it.
function nearPlan(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = [...text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu'))].map(match =>
    text.slice(match.index, match.index + 200),
  );
  return parts.length ? parts.join(' … ') : text;
}

// Does this amount appear in the text? "20" finds "$20/mo" and "20.00", not "120" or "20.5".
function shows(text, price) {
  const plain = text.replace(/(\d),(?=\d{3}\b)/g, '$1'); // "1,299" → "1299"
  return [String(price), price.toFixed(2)].some(form =>
    new RegExp(`(?<![\\d.])${form.replace('.', '\\.')}(?!\\d|\\.\\d)`).test(plain),
  );
}

// The plans whose price number changed: [{ plan, from, to, currency, period }].
// Only the same plan name, billing period and currency count, so a page that now shows yearly prices is no "change".
function priceChanges(before, after) {
  if (!before?.plans?.length || !after?.plans?.length) return [];
  const old = new Map(before.plans.map(plan => [planKey(plan), plan]));
  return after.plans.flatMap(plan => {
    const was = old.get(planKey(plan));
    if (!was || typeof was.price !== 'number' || typeof plan.price !== 'number') return [];
    if (was.currency !== plan.currency || Math.abs(was.price - plan.price) < 0.005) return [];
    return [{ plan: plan.name, from: was.price, to: plan.price, currency: plan.currency, period: plan.period }];
  });
}

function prompt(url, text) {
  return `This is the text of a pricing page (${url}), cut down to the parts about prices.

"""
${text}
"""

List its plans. Return JSON: {"plans": [{"name": "Pro", "price": 20, "currency": "USD", "period": "month"}]}
- "name": the plan's name as the page writes it ("Free", "Starter", "Pro", "Business")
- "price": the number only. 0 for a free plan. null when the page shows no number ("Contact us", "Custom").
- When the page shows both, give the price for paying month by month, not the yearly deal.
- "currency": the 3-letter code (USD, EUR, GBP, INR…)
- "period": "month", "year", "once", "user/month" or "user/year" (per user or per seat); "" when there is no number
- Up to ${MAX_PLANS} plans, in the page's order. Only plans in the text above; {"plans": []} when it shows none.`;
}

export default {
  kind: 'prices',
  everyDays: 30,
  // A few links per round (the daily wake-up, and every 15 minutes while you use the library): one AI question
  // each, and the free daily limit is shared with everything else. A link you open is checked right away.
  perRun: 6,
  needs: ['GROQ_API_KEY'],
  sources: ['web'],
  ai: true,

  async collect(link, facts) {
    const url = pricingPage(link);
    if (!url) return null;
    const old = facts?.prices?.plans?.length ? facts.prices : null;
    const page = await readNow(url);
    if (!page) return old; // can't read it now: keep what we know, and look again next time

    const answer = await askJson(prompt(url, around(page.text, PRICEY, MAX_TEXT)), 900);
    let plans = cleanPlans(answer.plans);
    if (!plans.length) return old; // the page didn't show its plans this time (or never did)

    // The AI can misread a page (a monthly/yearly switch, a price it made up). A plan only gets a new price
    // when the new number is next to the plan's name on the page and the old one is gone from there.
    if (old) {
      const before = new Map(old.plans.map(plan => [planKey(plan), plan]));
      plans = plans.map(plan => {
        const was = before.get(planKey(plan));
        if (!was || typeof was.price !== 'number' || typeof plan.price !== 'number' || was.price === plan.price) return plan;
        const near = nearPlan(page.text, plan.name);
        return shows(near, plan.price) && !shows(near, was.price) ? plan : { ...plan, price: was.price };
      });
    }
    const next = { plans, url };
    const rose = priceChanges(old, next).some(change => change.to > change.from);
    const upAt = rose ? new Date().toISOString() : old?.upAt;
    return upAt ? { ...next, upAt } : next;
  },

  async changes(link, before, after) {
    return priceChanges(before, after).map(data => ({ kind: 'price', data }));
  },
};
