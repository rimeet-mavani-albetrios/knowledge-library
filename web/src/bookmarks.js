// Bookmark files exported from Chrome, Edge, Firefox or Safari keep every link inside its folder.
// Each link gets its folder's name as a tag, so the way you sorted them comes along.

// The browser's own top folders aren't your topics.
const BROWSER_FOLDERS = /^(bookmarks( bar| menu| toolbar)?|other bookmarks|mobile bookmarks|favorites( bar)?|imported.*)$/i;

// The folder name just above a link, or '' when it sits in one of the browser's own folders.
function folderOf(link) {
  let heading = link.closest('dl')?.previousElementSibling;
  while (heading && heading.tagName !== 'H3') heading = heading.previousElementSibling;
  const name = heading?.textContent.replace(/\s+/g, ' ').trim() ?? '';
  return BROWSER_FOLDERS.test(name) ? '' : name.slice(0, 40);
}

// Returns { items: [{ url, tags }], folders } for a bookmarks file, or null for any other file.
export function parseBookmarks(text) {
  if (!/<h3[\s>]/i.test(text) || !/<a\s[^>]*href=/i.test(text)) return null;
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const items = new Map();
  const folders = new Set();
  for (const link of doc.querySelectorAll('a[href]')) {
    const url = link.getAttribute('href');
    if (!/^https?:\/\//i.test(url) || items.has(url)) continue;
    const folder = folderOf(link);
    if (folder) folders.add(folder);
    items.set(url, { url, tags: folder ? [folder] : [] });
  }
  return { items: [...items.values()], folders: [...folders] };
}
