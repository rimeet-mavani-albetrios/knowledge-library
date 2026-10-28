// How to put a "Save to library" button in your browser's bookmarks bar.
// The button is a bookmark with a little code in it (a "bookmarklet"): on any website, it opens your library's
// save page with that website's address, and the robot does the rest.
import { useEffect, useRef } from 'react';
import { BookmarkPlus } from 'lucide-react';
import Modal from './Modal.jsx';

const bookmarklet = origin =>
  `javascript:(()=>{window.open('${origin}/save?url='+encodeURIComponent(location.href),'kl-save','width=440,height=620')})()`;

export default function SaveButtonDialog({ open, onClose }) {
  const button = useRef(null);
  // React doesn't allow "javascript:" links, so the button's address is set directly.
  useEffect(() => {
    button.current?.setAttribute('href', bookmarklet(window.location.origin));
  });

  return (
    <Modal open={open} onClose={onClose} title="Save button for your browser" labelledBy="save-button-title" className="save-button-dialog">
      <p className="hint">Save any website you’re on with one click. It lands in your library with tags and a summary.</p>
      <ol className="steps">
        <li>
          Show your bookmarks bar: press <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>B</kbd> (on a Mac: <kbd>⌘</kbd> + <kbd>Shift</kbd> + <kbd>B</kbd>).
        </li>
        <li>
          Drag this button onto the bookmarks bar:
          <a ref={button} className="btn btn-primary bookmarklet" onClick={event => event.preventDefault()} title="Drag me to your bookmarks bar">
            <BookmarkPlus size={17} aria-hidden="true" /> Save to library
          </a>
        </li>
        <li>
          On any website, click <strong>Save to library</strong> in the bar. A small window saves it while you keep reading.
        </li>
      </ol>
      <p className="hint">Works in Chrome, Edge, Firefox and Safari on a computer. You need to be logged in to your library.</p>
    </Modal>
  );
}
