// The Explore map's data, turned into the shape the drawing engine needs.
//
// The server sends each dot with x and y between 0 and 1, and `aspect` (height ÷ width). Here every dot gets its
// place in "map units": x from 0 to 1 across, y from 0 to `aspect` down (y is flipped so the picture looks the
// same as the small map on the home page). The numbers go into typed arrays, which are quick to read 60 times
// a second.
import { categoryStyle } from '../../categories.jsx';

// "Developer Tools" and "Developer Tool", or "Marketing" and "marketing": the same words, give or take an "s".
const words = text => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/s\b/g, '');

// "near" arrives as one flat list per dot: [index, how alike (0–100), index, how alike, …].
function pairs(flat = []) {
  const list = [];
  for (let i = 0; i + 1 < flat.length; i += 2) list.push({ index: flat[i], alike: flat[i + 1] / 100 });
  return list;
}

export function prepareWorld({ points = [], aspect = 0.6, islands = [], topics = [], land = null }) {
  const n = points.length;
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const size = new Uint8Array(n); // 0 = a village, 1 = a town, 2 = a city (favorites and the links you open most)
  const flip = value => (1 - value) * aspect;
  points.forEach((point, i) => {
    x[i] = point.x;
    y[i] = flip(point.y);
    size[i] = point.size ?? 0;
  });
  const indexOf = new Map(points.map((point, i) => [point.id, i]));

  // The categories, biggest first, with the dots of each.
  const members = new Map();
  points.forEach((point, i) => {
    if (!members.has(point.category)) members.set(point.category, []);
    members.get(point.category).push(i);
  });
  const categories = [...members]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([name, list]) => ({ name, short: categoryStyle(name).short, dots: Int32Array.from(list) }));

  // A topic name that only repeats a category's name ("Developer Tools" near the "Dev tools" island) says nothing new.
  // When the same topic comes up twice at a zoom level, the bigger group keeps it: it would look like a mistake twice.
  const categoryWords = new Set(categories.flatMap(category => [words(category.name), words(category.short)]));
  const seenTopics = new Set();
  const topicList = [...topics]
    .sort((a, b) => b.count - a.count)
    .filter(topic => {
      const key = `${topic.level}|${words(topic.text)}`;
      if (categoryWords.has(words(topic.text)) || seenTopics.has(key)) return false;
      seenTopics.add(key);
      return true;
    })
    .map((topic, i) => ({ key: `topic-${i}`, text: topic.text, level: topic.level, count: topic.count, x: topic.x, y: flip(topic.y) }));

  const islandList = islands.map((island, i) => ({
    key: `island-${i}`,
    category: island.name,
    text: categoryStyle(island.name).short,
    x: island.x,
    y: flip(island.y),
    count: island.count,
    box: island.box, // left, top, right, bottom in map units
    tags: island.tags ?? [],
    top: island.top ?? [],
  }));

  return {
    n,
    aspect,
    x,
    y,
    size,
    ids: points.map(point => point.id),
    titles: points.map(point => point.title || 'Untitled link'),
    category: points.map(point => point.category),
    icons: points.map(point => point.icon ?? ''),
    github: points.map(point => Boolean(point.gh)),
    near: points.map(point => pairs(point.near)),
    indexOf,
    categories,
    islands: islandList,
    islandOf: new Map(islandList.map(island => [island.category, island])),
    topics: topicList,
    land,
  };
}

// What SiteIcon (LinkCard.jsx) needs to draw a dot's little picture, before the link's full details have arrived.
export const iconLink = (world, index) => ({
  category: world.category[index],
  iconUrl: world.icons[index],
  source: world.github[index] ? 'github' : 'web',
  status: 'ready',
});
