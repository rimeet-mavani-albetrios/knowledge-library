// The "why it matched" line. The server marks your search words with two invisible characters; they become bold here.
export default function Highlight({ text }) {
  return text
    .split(/([^]*)/)
    .map((part, i) => (part.startsWith('') ? <mark key={i}>{part.slice(1, -1)}</mark> : part));
}
