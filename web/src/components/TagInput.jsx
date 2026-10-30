// Tags as chips, in "Add links" and in the details window's Edit form.
// Type a tag, then Enter or a comma makes it a chip. × takes one out; Backspace on an empty box takes out the last one.
// The value given back is the comma list the server expects ("video, free").
// `onTyping` hears whether the box holds letters that aren't a chip yet, so a form can count them as unsaved.
import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import './tag-input.css';

const MAX_TAG_LENGTH = 40;

export default function TagInput({ id, value, onChange, placeholder, onTyping }) {
  const [draft, setDraft] = useState('');
  const input = useRef(null);
  const tags = useMemo(() => value.split(',').map(tag => tag.trim()).filter(Boolean), [value]);
  const typing = Boolean(draft.trim());
  useEffect(() => {
    onTyping?.(typing);
  }, [typing, onTyping]);

  function add(text) {
    const next = [...tags];
    for (const part of text.split(',')) {
      const tag = part.trim().slice(0, MAX_TAG_LENGTH);
      if (tag && !next.some(known => known.toLowerCase() === tag.toLowerCase())) next.push(tag);
    }
    if (next.length !== tags.length) onChange(next.join(', '));
    setDraft('');
  }

  const remove = index => onChange(tags.filter((_, i) => i !== index).join(', '));

  return (
    <div className={`tag-input${tags.length ? ' has-tags' : ''}`} onClick={() => input.current?.focus()}>
      {tags.map((tag, index) => (
        <span key={tag} className="tag-chip">
          {tag}
          <button type="button" className="tag-chip-remove" aria-label={`Remove tag ${tag}`} onClick={() => remove(index)}>
            <X size={13} aria-hidden="true" />
          </button>
        </span>
      ))}
      <input
        ref={input}
        id={id}
        className="tag-input-field"
        value={draft}
        maxLength={MAX_TAG_LENGTH + 1}
        placeholder={tags.length ? '' : placeholder}
        autoComplete="off"
        onChange={event => (event.target.value.includes(',') ? add(event.target.value) : setDraft(event.target.value))}
        onBlur={() => draft.trim() && add(draft)}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            // Enter adds a chip here; it must not press the form's main button.
            event.preventDefault();
            add(draft);
          } else if (event.key === 'Backspace' && !draft && tags.length) {
            event.preventDefault();
            remove(tags.length - 1);
          }
        }}
      />
    </div>
  );
}
