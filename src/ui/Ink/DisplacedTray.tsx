/**
 * Annotations whose code went away.
 *
 * The product rule is that a handwritten note is never silently moved to code it was not
 * written about. When the anchor ladder cannot justify a position, this is where the note
 * goes — visible, attributed to the text it was written against, and not drawn over anything.
 *
 * Reattaching is not a Phase 2 feature. What matters now is that nothing disappears quietly.
 */

import { useInk } from '@/store/ink';
import { deleteAnnotation } from '@/db';
import type { Annotation } from '@/model/types';
import './ink.css';

/** The line the note was written against, as it read at the time. */
function original(annotation: Annotation): string {
  const { contextBefore, contextAfter } = annotation.anchor;
  return contextBefore.at(-1) ?? contextAfter[0] ?? '';
}

export function DisplacedTray() {
  const displaced = useInk((s) => s.displaced);

  if (displaced.length === 0) return null;

  const forget = async (id: string) => {
    await deleteAnnotation(id);
    useInk.setState((s) => ({
      displaced: s.displaced.filter((a) => a.id !== id),
      revision: s.revision + 1,
    }));
  };

  return (
    <aside className="ac-displaced" aria-label="Displaced annotations">
      <p className="ac-displaced-title">
        {displaced.length} {displaced.length === 1 ? 'annotation' : 'annotations'} lost their
        place
      </p>
      <p className="ac-displaced-hint">
        The code they were written on has changed too much to place them safely.
      </p>

      <ul className="ac-displaced-list">
        {displaced.map((annotation) => (
          <li key={annotation.id}>
            <span className="ac-displaced-line">line {annotation.anchor.line + 1}</span>
            <code className="ac-displaced-code">{original(annotation) || '—'}</code>
            <button type="button" onClick={() => void forget(annotation.id)}>
              Forget
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
