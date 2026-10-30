// The weekly email, "Your library this week": a light page made of tables (what Gmail, Outlook and phone mail apps
// show the same way), with every style written on the tag itself, plus a plain-text copy for mail apps without HTML.
import { settings } from '../config.js';

const MAX_PER_SECTION = 10;
const FONT = "font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
const C = { bg: '#f6f7fb', card: '#ffffff', line: '#e3e6ee', text: '#14182b', text2: '#444b62', muted: '#6b7287', accent: '#4b3ff0' };

const SECTIONS = {
  price: { title: 'Price changes', label: 'Price changes', one: 'link with new prices', many: 'links with new prices', color: '#9a5b00', soft: '#fff4e0' },
  feature: { title: 'New features', label: 'New features', one: 'link with new features', many: 'links with new features', color: '#1c7c54', soft: '#e6f4ed' },
  dead: { title: 'Stopped working', label: 'Broken links', one: 'broken link', many: 'broken links', color: '#c4372f', soft: '#fdecea' },
  rising: { title: 'Getting more popular', label: 'Rising', one: 'website getting popular', many: 'websites getting popular', color: C.accent, soft: '#eef0ff' },
};

const escape = value =>
  String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

const hostOf = url => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const day = date => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(date);

function money(amount, currency) {
  if (amount === null || amount === undefined || amount === '') return '';
  if (typeof amount !== 'number') return String(amount); // "Custom", "$12"…
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount);
  } catch {
    return `${amount} ${currency ?? ''}`.trim();
  }
}

const per = period => (period && !/one|once|life/i.test(period) ? ` a ${String(period).replace(/ly$/, '').replace(/^annual$/, 'year')}` : '');
const rank = bucket => `the top ${Number(bucket).toLocaleString('en-US')}`;

// What changed, in a line or a few.
function details({ kind, changes }) {
  if (kind === 'price') {
    return changes.slice(0, 3).map(({ plan, from, to, currency, period }) => {
      const name = plan ? `${plan}: ` : '';
      const was = money(from, currency);
      const now = money(to, currency);
      if (was && now) {
        const way = typeof from === 'number' && typeof to === 'number' ? (to > from ? ' (went up)' : ' (went down)') : '';
        return `${name}${was} → ${now}${per(period)}${way}`;
      }
      if (now) return `New plan: ${plan || 'a plan'}, ${now}${per(period)}`;
      return `${plan || 'A'} plan was removed${was ? ` (was ${was}${per(period)})` : ''}`;
    });
  }
  if (kind === 'feature') {
    const names = changes.map(change => change.name).filter(Boolean);
    return [`New: ${names.slice(0, 5).join(', ')}${names.length > 5 ? ` and ${names.length - 5} more` : ''}`];
  }
  if (kind === 'dead') return ['The page stopped opening. It may have moved or closed.'];
  if (kind === 'rising') {
    const { from, to } = changes[0] ?? {};
    if (!to) return ['More people visit it than before.'];
    return [`Now in ${rank(to)} websites${from ? ` (was ${rank(from)})` : ''}.`];
  }
  return [];
}

const openUrl = (base, id) => `${base}/?link=${encodeURIComponent(id)}`;
const nameOf = link => link.title || link.siteName || hostOf(link.url) || link.url;

function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:8px;background:${C.accent};">
<a href="${escape(href)}" style="display:inline-block;padding:8px 14px;${FONT}font-size:13px;font-weight:600;line-height:16px;color:#ffffff;text-decoration:none;border-radius:8px;">${escape(label)}</a>
</td></tr></table>`;
}

const paragraph = (text, style = '') =>
  `<p style="margin:0 0 12px;${FONT}font-size:15px;line-height:22px;color:${C.text2};${style}">${text}</p>`;

function countsRow(groups) {
  const cells = Object.entries(SECTIONS)
    .map(
      ([kind, info]) => `<td width="25%" align="center" valign="top" style="padding:12px 4px;background:${info.soft};border-radius:10px;">
<div style="${FONT}font-size:24px;font-weight:700;line-height:28px;color:${info.color};">${groups[kind].length}</div>
<div style="${FONT}font-size:12px;line-height:16px;color:${C.text2};">${info.label}</div></td>`,
    )
    .join('<td width="8" style="font-size:0;line-height:0;">&nbsp;</td>');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`;
}

function sectionHtml(kind, entries, base) {
  const info = SECTIONS[kind];
  const shown = entries.slice(0, MAX_PER_SECTION);
  const items = shown
    .map(
      entry => `<tr><td style="padding:14px 0;border-top:1px solid ${C.line};">
<div style="${FONT}font-size:15px;font-weight:600;line-height:20px;color:${C.text};">${escape(nameOf(entry.link))}</div>
<div style="${FONT}font-size:12px;line-height:18px;color:${C.muted};">${escape(hostOf(entry.link.url))}</div>
${details(entry)
  .map(line => `<div style="${FONT}font-size:14px;line-height:20px;color:${C.text2};padding-top:4px;">${escape(line)}</div>`)
  .join('')}
<div style="padding-top:10px;">${button(openUrl(base, entry.link.id), 'Open in library')}</div>
</td></tr>`,
    )
    .join('');
  const more =
    entries.length > shown.length
      ? `<tr><td style="padding:10px 0;border-top:1px solid ${C.line};${FONT}font-size:14px;"><a href="${escape(base)}/" style="color:${C.accent};">and ${entries.length - shown.length} more in your library</a></td></tr>`
      : '';
  return `<tr><td style="padding:24px 28px 0;">
<div style="${FONT}font-size:13px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${info.color};padding-bottom:6px;">${info.title} · ${entries.length}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${items}${more}</table>
</td></tr>`;
}

function sectionText(kind, entries, base) {
  const lines = [`${SECTIONS[kind].title.toUpperCase()} (${entries.length})`];
  for (const entry of entries.slice(0, MAX_PER_SECTION)) {
    lines.push('', `- ${nameOf(entry.link)} (${hostOf(entry.link.url)})`);
    for (const line of details(entry)) lines.push(`  ${line}`);
    lines.push(`  Open: ${openUrl(base, entry.link.id)}`);
  }
  if (entries.length > MAX_PER_SECTION) lines.push('', `  and ${entries.length - MAX_PER_SECTION} more: ${base}/`);
  return lines.join('\n');
}

// `entries` come from weekChanges(). Returns { subject, html, text }.
export function weeklyEmail({ entries, now = new Date(), base, test = false }) {
  const title = 'Your library this week';
  const groups = Object.fromEntries(Object.keys(SECTIONS).map(kind => [kind, entries.filter(entry => entry.kind === kind)]));
  const kinds = Object.keys(SECTIONS).filter(kind => groups[kind].length);
  const quiet = !kinds.length;
  const range = `${day(new Date(now.getTime() - 7 * 86_400_000))} – ${day(now)}`;
  const summary = quiet
    ? 'A quiet week: nothing changed on your saved links.'
    : kinds.map(kind => `${groups[kind].length} ${groups[kind].length === 1 ? SECTIONS[kind].one : SECTIONS[kind].many}`).join(', ');

  const testNote = test
    ? `This is a test email. The real one comes every Monday morning (9:00 India time) with the last 7 days of changes.${
        quiet ? ' The library only just started watching your links, so there is not much in it yet. It fills up as the robot checks them.' : ''
      }`
    : '';
  const footer = `You get this every Monday because the weekly email is on. To stop it, open your library, click ⋯ at the top right, and turn off "Weekly email".`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${title}</title></head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escape(summary)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:${C.card};border:1px solid ${C.line};border-radius:14px;">
<tr><td style="padding:28px 28px 0;">
<div style="${FONT}font-size:13px;font-weight:600;line-height:18px;color:${C.accent};">${escape(settings.title)}</div>
<h1 style="margin:4px 0 2px;${FONT}font-size:24px;font-weight:700;line-height:30px;color:${C.text};">${title}</h1>
<div style="${FONT}font-size:13px;line-height:18px;color:${C.muted};padding-bottom:18px;">${escape(range)}</div>
${test ? `<div style="margin:0 0 18px;padding:12px 14px;background:#eef0ff;border-radius:10px;${FONT}font-size:14px;line-height:20px;color:${C.text2};">${escape(testNote)}</div>` : ''}
${
  quiet
    ? `${paragraph('A quiet week. Nothing changed on your saved links: no new prices, no new features, nothing broke.')}
<div style="padding:6px 0 4px;">${button(`${base}/`, 'Open your library')}</div>`
    : countsRow(groups)
}
</td></tr>
${kinds.map(kind => sectionHtml(kind, groups[kind], base)).join('')}
<tr><td style="padding:24px 28px 26px;">
<div style="border-top:1px solid ${C.line};padding-top:16px;${FONT}font-size:12px;line-height:18px;color:${C.muted};">${escape(footer)}</div>
</td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = [
    `${settings.title}: ${title}`,
    range,
    '',
    ...(test ? [testNote, ''] : []),
    quiet ? `A quiet week. Nothing changed on your saved links.\nOpen your library: ${base}/` : `This week: ${summary}.`,
    ...kinds.map(kind => `\n${sectionText(kind, groups[kind], base)}`),
    '',
    '--',
    footer,
  ].join('\n');

  return { subject: test ? `Test: ${title}` : title, html, text };
}
