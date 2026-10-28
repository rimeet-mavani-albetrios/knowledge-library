// Backups: your whole library as JSON, a spreadsheet (CSV), or a bookmarks file any browser can import.

const escapeHtml = text => String(text ?? '').replace(/[&<>"]/g, char => `&#${char.charCodeAt(0)};`);
const csvCell = value => `"${String(value ?? '').replace(/"/g, '""')}"`;

export function exportLinks(links, format, title) {
  const date = new Date().toISOString().slice(0, 10);
  if (format === 'csv') {
    const columns = ['title', 'url', 'category', 'tags', 'tasks', 'level', 'pricing', 'summary', 'useFor', 'collection', 'note', 'favorite', 'myStatus', 'opens', 'createdAt'];
    const rows = links.map(link => columns.map(column => csvCell(Array.isArray(link[column]) ? link[column].join(', ') : link[column])).join(','));
    return { name: `knowledge-library-${date}.csv`, type: 'text/csv; charset=utf-8', body: [columns.join(','), ...rows].join('\n') };
  }
  if (format === 'html') {
    const byCategory = Map.groupBy(links, link => link.category);
    const folders = [...byCategory]
      .map(
        ([category, items]) =>
          `    <DT><H3>${escapeHtml(category)}</H3>\n    <DL><p>\n${items
            .map(link => `        <DT><A HREF="${escapeHtml(link.url)}" ADD_DATE="${Math.floor(new Date(link.createdAt) / 1000)}" TAGS="${escapeHtml(link.tags.join(','))}">${escapeHtml(link.title)}</A>`)
            .join('\n')}\n    </DL><p>`,
      )
      .join('\n');
    const body = `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>${escapeHtml(title)}</TITLE>\n<H1>${escapeHtml(title)}</H1>\n<DL><p>\n${folders}\n</DL><p>\n`;
    return { name: `knowledge-library-${date}.html`, type: 'text/html; charset=utf-8', body };
  }
  return { name: `knowledge-library-${date}.json`, type: 'application/json', body: JSON.stringify({ exportedAt: new Date(), links }, null, 2) };
}
