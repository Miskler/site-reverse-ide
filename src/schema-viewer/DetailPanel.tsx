import CodeMirror from '@uiw/react-codemirror';
import { JSON_EDITOR_THEME, JSON_OUTPUT_EXTENSIONS } from '../lib/json-editor';
import { appToast } from '../lib/app-toast';
import type { SelectionDetails } from './schema-types';
import { formatJsonPointerForCode } from './pointer-format';

interface DetailPanelProps {
  details: SelectionDetails | null;
  localJson: string | null;
  onClose: () => void;
}

const INSPECTOR_JSON_HEIGHT = 'clamp(160px, 26vh, 420px)';
const LOCAL_INSPECTOR_JSON_HEIGHT = 'clamp(120px, 20vh, 280px)';

function formatJsonForDisplay(value: string | null): string {
  if (!value) {
    return '';
  }

  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export function DetailPanel({ details, localJson, onClose }: DetailPanelProps) {
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

  async function copyJsonPointer() {
    try {
      await navigator.clipboard.writeText(formatJsonPointerForCode(selectionDetails.jsonPointer));
      appToast.success('JSON path copied');
    } catch {
      appToast.error('Unable to copy JSON path');
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
          <span className="schema-viewer__label">Pointers</span>
          <button type="button" onClick={() => void copyPointer()}>
            Copy schema
          </button>
        </div>

        <div className="schema-viewer__pointer-stack">
          <div className="schema-viewer__pointer-item">
            <div className="schema-viewer__pointer-head">
              <span className="schema-viewer__pointer-label">Schema pointer</span>
            </div>
            <code className="schema-viewer__code-block">{selectionDetails.schemaPointer}</code>
          </div>

          <div className="schema-viewer__pointer-item">
            <div className="schema-viewer__pointer-head">
              <span className="schema-viewer__pointer-label">JSON pointer</span>
              <button type="button" className="schema-viewer__pointer-copy" onClick={() => void copyJsonPointer()}>
                Copy code
              </button>
            </div>
            <code className="schema-viewer__code-block">
              {formatJsonPointerForCode(selectionDetails.jsonPointer)}
            </code>
          </div>
        </div>
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

      <div className="schema-viewer__section">
        <div className="schema-viewer__section-head">
          <span className="schema-viewer__label">JSON (локальный)</span>
        </div>
        <div className="schema-viewer__json-preview schema-viewer__json-preview--local">
          <CodeMirror
            className="schema-viewer__json-preview-editor"
            value={formatJsonForDisplay(localJson)}
            height={LOCAL_INSPECTOR_JSON_HEIGHT}
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
