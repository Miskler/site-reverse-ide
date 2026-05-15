import CodeMirror from '@uiw/react-codemirror';
import { JSON_EDITOR_THEME, JSON_OUTPUT_EXTENSIONS } from '../lib/json-editor';
import { appToast } from '../lib/app-toast';
import type { SelectionDetails } from './schema-types';

interface DetailPanelProps {
  details: SelectionDetails | null;
  onClose: () => void;
}

const INSPECTOR_JSON_HEIGHT = 'clamp(220px, 32vh, 420px)';

export function DetailPanel({ details, onClose }: DetailPanelProps) {
  const currentDetails = details;

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
      appToast.success('Pointer copied');
    } catch {
      appToast.error('Unable to copy pointer');
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

      <div className="schema-viewer__section">
        <div className="schema-viewer__section-head">
          <span className="schema-viewer__label">Schema pointer</span>
          <button type="button" onClick={() => void copyPointer()}>
            Copy
          </button>
        </div>
        <code className="schema-viewer__code-block">{selectionDetails.schemaPointer}</code>
      </div>

      <div className="schema-viewer__section">
        <div className="schema-viewer__section-head">
          <span className="schema-viewer__label">Schema JSON</span>
        </div>
        <div className="schema-viewer__json-preview">
          <CodeMirror
            className="schema-viewer__json-preview-editor"
            value={JSON.stringify(selectionDetails.schema, null, 2)}
            height={INSPECTOR_JSON_HEIGHT}
            theme={JSON_EDITOR_THEME}
            extensions={JSON_OUTPUT_EXTENSIONS}
            editable={false}
            readOnly
            basicSetup={false}
            spellCheck={false}
          />
        </div>
      </div>
    </aside>
  );
}
