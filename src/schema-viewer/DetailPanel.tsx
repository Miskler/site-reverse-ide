import { useEffect, useState } from 'react';
import type { SelectionDetails } from './schema-types';

interface DetailPanelProps {
  details: SelectionDetails | null;
  onClose: () => void;
}

export function DetailPanel({ details, onClose }: DetailPanelProps) {
  const [copied, setCopied] = useState(false);
  const currentDetails = details;

  useEffect(() => {
    setCopied(false);
  }, [details]);

  if (!currentDetails) {
    return (
      <aside className="schema-viewer__panel schema-viewer__panel--details">
        <div className="schema-viewer__eyebrow">Inspector</div>
        <h2 className="schema-viewer__title schema-viewer__title--compact">Selection</h2>
        <p className="schema-viewer__hint">
          Select a node or field in the canvas to inspect its schema fragment.
        </p>
      </aside>
    );
  }

  const selectionDetails = currentDetails;

  async function copyPointer() {
    try {
      await navigator.clipboard.writeText(selectionDetails.schemaPointer);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <aside className="schema-viewer__panel schema-viewer__panel--details">
      <div className="schema-viewer__detail-header">
        <div>
          <div className="schema-viewer__eyebrow">Inspector</div>
          <div className="schema-viewer__detail-title-row">
            <h2 className="schema-viewer__title schema-viewer__title--compact">{selectionDetails.heading}</h2>
            <span className="schema-viewer__badge">{selectionDetails.badge}</span>
          </div>
        </div>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>

      {selectionDetails.description ? (
        <p className="schema-viewer__description">{selectionDetails.description}</p>
      ) : null}

      {selectionDetails.facts.length > 0 ? (
        <div className="schema-viewer__facts">
          {selectionDetails.facts.map((fact) => (
            <span className="schema-viewer__fact" key={fact}>
              {fact}
            </span>
          ))}
        </div>
      ) : null}

      <div className="schema-viewer__section">
        <div className="schema-viewer__section-head">
          <span className="schema-viewer__label">Schema pointer</span>
          <button type="button" onClick={() => void copyPointer()}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <code className="schema-viewer__code-block">{selectionDetails.schemaPointer}</code>
      </div>

      <div className="schema-viewer__section">
        <div className="schema-viewer__section-head">
          <span className="schema-viewer__label">Schema JSON</span>
        </div>
        <pre className="schema-viewer__json-preview">
          {JSON.stringify(selectionDetails.schema, null, 2)}
        </pre>
      </div>
    </aside>
  );
}
