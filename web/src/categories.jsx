// Every category is a "territory" with its own color and icon. The same color is used on the map dots,
// the filter chips (which double as the map's legend) and the frame around each card's picture.
import {
  Sparkles, Gauge, Bot, MessageSquareText, Wrench, CodeXml, LayoutTemplate, Server, FlaskConical, Palette, Workflow,
  ListTodo, Megaphone, Handshake, Mail, Rocket, Wallet, ListChecks, GraduationCap, BookOpen, Newspaper, CirclePlay,
  BookMarked, Users, Rss, ShoppingCart, Database, Bookmark,
} from 'lucide-react';

const CATEGORY_STYLE = {
  'AI Tool': { color: '#7c5cff', Icon: Sparkles, short: 'AI tools' },
  'AI Model & Benchmark': { color: '#4f5bd5', Icon: Gauge, short: 'AI models' },
  'Agents, Skills & MCP': { color: '#e8457c', Icon: Bot, short: 'Agents & MCP' },
  Prompts: { color: '#f29d0c', Icon: MessageSquareText, short: 'Prompts' },
  'Developer Tool': { color: '#2f7bf5', Icon: Wrench, short: 'Dev tools' },
  'Code Library': { color: '#64748b', Icon: CodeXml, short: 'Code' },
  'UI Components': { color: '#b5179e', Icon: LayoutTemplate, short: 'UI components' },
  'Backend & Hosting': { color: '#20718f', Icon: Server, short: 'Backend' },
  Testing: { color: '#7cab1f', Icon: FlaskConical, short: 'Testing' },
  Design: { color: '#c04fe0', Icon: Palette, short: 'Design' },
  'Workflows & Automation': { color: '#0fa58a', Icon: Workflow, short: 'Workflows' },
  Productivity: { color: '#5b8c5a', Icon: ListTodo, short: 'Productivity' },
  'Marketing & Social Media': { color: '#e2a400', Icon: Megaphone, short: 'Marketing' },
  'Sales & CRM': { color: '#0d7a5f', Icon: Handshake, short: 'Sales & CRM' },
  'Messaging & Email': { color: '#2563a8', Icon: Mail, short: 'Messaging' },
  'Startup & Business': { color: '#8d6e63', Icon: Rocket, short: 'Startup' },
  Finance: { color: '#b8860b', Icon: Wallet, short: 'Finance' },
  'Directory & List': { color: '#9e7bb5', Icon: ListChecks, short: 'Directories' },
  'Tutorial & Course': { color: '#3f9d3a', Icon: GraduationCap, short: 'Tutorials' },
  Documentation: { color: '#1aa0c9', Icon: BookOpen, short: 'Docs' },
  Article: { color: '#f2673a', Icon: Newspaper, short: 'Articles' },
  'Video & Podcast': { color: '#e5484d', Icon: CirclePlay, short: 'Videos' },
  Book: { color: '#b45309', Icon: BookMarked, short: 'Books' },
  Community: { color: '#ad1457', Icon: Users, short: 'Communities' },
  News: { color: '#0e7490', Icon: Rss, short: 'News' },
  Shopping: { color: '#d9480f', Icon: ShoppingCart, short: 'Shopping' },
  Dataset: { color: '#a0753d', Icon: Database, short: 'Datasets' },
  Other: { color: '#8a94a8', Icon: Bookmark, short: 'Other' },
};

export const categoryStyle = name => CATEGORY_STYLE[name] ?? CATEGORY_STYLE.Other;

// For style={...}: sets the --hue color that the CSS turns into soft backgrounds and readable text.
export const hueOf = name => ({ '--hue': categoryStyle(name).color });

export function CategoryBadge({ name }) {
  const { Icon } = categoryStyle(name);
  return (
    <span className="badge" style={hueOf(name)}>
      <Icon size={13} aria-hidden="true" />
      {name}
    </span>
  );
}
