// Every category is a "territory" with its own color and icon. The same color is used on the map dots,
// the filter chips (which double as the map's legend) and the frame around each card's picture.
import {
  Sparkles, Gauge, Bot, MessageSquareText, Wrench, CodeXml, LayoutTemplate, Server, FlaskConical, Palette, Workflow,
  ListTodo, Megaphone, Handshake, Mail, Rocket, Wallet, ListChecks, GraduationCap, BookOpen, Newspaper, CirclePlay,
  BookMarked, Users, Rss, ShoppingCart, Database, Bookmark,
} from 'lucide-react';

// Each category has two colors: `color` for the light theme and `dark` for the dark theme.
// The dark ones are brighter and a little softer, and all about equally bright, so none looks dull on a dark page.
// A few are nudged apart in hue (the blues, the oranges, the greens), so two categories never look the same.
const CATEGORY_STYLE = {
  'AI Tool': { color: '#7c5cff', dark: '#ae92fe', Icon: Sparkles, short: 'AI tools' },
  'AI Model & Benchmark': { color: '#4f5bd5', dark: '#9fa9fc', Icon: Gauge, short: 'AI models' },
  'Agents, Skills & MCP': { color: '#e8457c', dark: '#ff91aa', Icon: Bot, short: 'Agents & MCP' },
  Prompts: { color: '#f29d0c', dark: '#ffb84f', Icon: MessageSquareText, short: 'Prompts' },
  'Developer Tool': { color: '#2f7bf5', dark: '#68a5ff', Icon: Wrench, short: 'Dev tools' },
  'Code Library': { color: '#64748b', dark: '#9cacc1', Icon: CodeXml, short: 'Code' },
  'UI Components': { color: '#b5179e', dark: '#e77eda', Icon: LayoutTemplate, short: 'UI components' },
  'Backend & Hosting': { color: '#20718f', dark: '#74aac6', Icon: Server, short: 'Backend' },
  Testing: { color: '#7cab1f', dark: '#b0d45f', Icon: FlaskConical, short: 'Testing' },
  Design: { color: '#c04fe0', dark: '#d796f7', Icon: Palette, short: 'Design' },
  'Workflows & Automation': { color: '#0fa58a', dark: '#5dd5c6', Icon: Workflow, short: 'Workflows' },
  Productivity: { color: '#5b8c5a', dark: '#a8c9a1', Icon: ListTodo, short: 'Productivity' },
  'Marketing & Social Media': { color: '#e2a400', dark: '#f3d350', Icon: Megaphone, short: 'Marketing' },
  'Sales & CRM': { color: '#0d7a5f', dark: '#67c499', Icon: Handshake, short: 'Sales & CRM' },
  'Messaging & Email': { color: '#2563a8', dark: '#84c1f7', Icon: Mail, short: 'Messaging' },
  'Startup & Business': { color: '#8d6e63', dark: '#bda09d', Icon: Rocket, short: 'Startup' },
  Finance: { color: '#b8860b', dark: '#ddb558', Icon: Wallet, short: 'Finance' },
  'Directory & List': { color: '#9e7bb5', dark: '#c3abde', Icon: ListChecks, short: 'Directories' },
  'Tutorial & Course': { color: '#3f9d3a', dark: '#6bca75', Icon: GraduationCap, short: 'Tutorials' },
  Documentation: { color: '#1aa0c9', dark: '#76d7f4', Icon: BookOpen, short: 'Docs' },
  Article: { color: '#f2673a', dark: '#f8b287', Icon: Newspaper, short: 'Articles' },
  'Video & Podcast': { color: '#e5484d', dark: '#f96f70', Icon: CirclePlay, short: 'Videos' },
  Book: { color: '#b45309', dark: '#de9a60', Icon: BookMarked, short: 'Books' },
  Community: { color: '#ad1457', dark: '#e6739e', Icon: Users, short: 'Communities' },
  News: { color: '#0e7490', dark: '#64c3c6', Icon: Rss, short: 'News' },
  Shopping: { color: '#d9480f', dark: '#f78857', Icon: ShoppingCart, short: 'Shopping' },
  Dataset: { color: '#a0753d', dark: '#c8a87c', Icon: Database, short: 'Datasets' },
  Other: { color: '#8a94a8', dark: '#b9c1d2', Icon: Bookmark, short: 'Other' },
};

export const categoryStyle = name => CATEGORY_STYLE[name] ?? CATEGORY_STYLE.Other;

// For style={...}: sets the --hue color that the CSS turns into soft backgrounds and readable text.
// It also carries the dark-theme color as --hue-dark. In the dark theme, styles.css makes --hue use it, so every
// element (and code that reads --hue with getComputedStyle, like a map drawn on a canvas) gets the dark-friendly color.
export const hueOf = name => {
  const { color, dark } = categoryStyle(name);
  return { '--hue': color, '--hue-dark': dark };
};

// The category's color for the theme on screen right now, for code that draws colors itself (a canvas, a chart).
// It reads the theme when called, so call it again after the theme changes.
export const categoryColor = name => {
  const { color, dark } = categoryStyle(name);
  return document.documentElement.dataset.theme === 'dark' ? dark : color;
};

export function CategoryBadge({ name }) {
  const { Icon } = categoryStyle(name);
  return (
    <span className="badge" style={hueOf(name)}>
      <Icon size={13} aria-hidden="true" />
      {name}
    </span>
  );
}
