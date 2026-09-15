/**
 * The file tree.
 *
 * Rows are a fixed height and rendered through a window, so a 5,000-file repository puts
 * about thirty elements in the DOM rather than five thousand. The tree structure itself is
 * computed once in `tree.ts`; this component only ever looks at the flattened row list.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '@/store/session';
import { flatten } from './tree';
import './filetree.css';

const ROW_HEIGHT = 24;
/** Rendered above and below the viewport, so fast scrolling never shows a gap. */
const OVERSCAN = 8;

export function FileTree() {
  const tree = useSession((s) => s.tree);
  const expanded = useSession((s) => s.expanded);
  const activeFile = useSession((s) => s.activeFile);
  const warnings = useSession((s) => s.warnings);
  const toggleDirectory = useSession((s) => s.toggleDirectory);
  const openFile = useSession((s) => s.openFile);

  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);

  const rows = useMemo(() => flatten(tree, expanded), [tree, expanded]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;

    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    setHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  // Keep the open file on screen when it is opened from somewhere other than the tree.
  useEffect(() => {
    const element = scroller.current;
    if (!element || !activeFile) return;

    const index = rows.findIndex((r) => r.node.fileId === activeFile.id);
    if (index < 0) return;

    const top = index * ROW_HEIGHT;
    if (top < element.scrollTop || top + ROW_HEIGHT > element.scrollTop + element.clientHeight) {
      element.scrollTop = top - element.clientHeight / 3;
    }
  }, [activeFile, rows]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);
  const visible = rows.slice(first, last);

  return (
    <div className="ac-tree">
      <div
        className="ac-tree-scroll"
        ref={scroller}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div className="ac-tree-sizer" style={{ height: rows.length * ROW_HEIGHT }}>
          <div className="ac-tree-window" style={{ transform: `translateY(${first * ROW_HEIGHT}px)` }}>
            {visible.map(({ node, depth }) => {
              const isActive = node.fileId !== undefined && node.fileId === activeFile?.id;
              const isOpen = node.kind === 'dir' && expanded.has(node.path);

              return (
                <button
                  key={node.path}
                  type="button"
                  className={`ac-row ${node.kind} ${isActive ? 'is-active' : ''}`}
                  style={{ paddingLeft: 8 + depth * 13 }}
                  title={node.path}
                  onClick={() =>
                    node.kind === 'dir' ? toggleDirectory(node.path) : void openFile(node.fileId!)
                  }
                >
                  {node.kind === 'dir' ? (
                    <svg className={`ac-caret ${isOpen ? 'is-open' : ''}`} viewBox="0 0 12 12" aria-hidden="true">
                      <path d="M4.5 2.5 L8 6 L4.5 9.5" />
                    </svg>
                  ) : (
                    <span className="ac-caret" aria-hidden="true" />
                  )}
                  <span className="ac-row-name">{node.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="ac-tree-notes">
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      )}
    </div>
  );
}
