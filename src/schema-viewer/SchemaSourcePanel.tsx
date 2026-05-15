import CodeMirror from '@uiw/react-codemirror';
import { JSON_EDITOR_THEME, JSON_INPUT_EXTENSIONS } from '../lib/json-editor';

interface SchemaSourcePanelProps {
  sourceText: string;
  sourceOrigin: string;
  busy: boolean;
  hasDefaultSchema: boolean;
  onBackToGraph: () => void;
  onSourceChange: (value: string) => void;
  onPaste: () => void | Promise<void>;
  onClear: () => void;
  onApply: () => void;
  onReset: () => void;
}

export function SchemaSourcePanel({
  sourceText,
  sourceOrigin,
  busy,
  hasDefaultSchema,
  onBackToGraph,
  onSourceChange,
  onPaste,
  onClear,
  onApply,
  onReset,
}: SchemaSourcePanelProps) {
  return (
    <aside className="schema-viewer__panel schema-viewer__panel--source">
      <div className="schema-viewer__eyebrow">Schema Input</div>
      <h1 className="schema-viewer__title">JSON Schema Viewer</h1>
      <p className="schema-viewer__lead">
        Paste a JSON Schema document and render it as a navigable diagram.
      </p>

      <div className="schema-viewer__meta">
        <span className="schema-viewer__chip">{busy ? 'Updating...' : 'Ready'}</span>
        <span className="schema-viewer__chip">{sourceOrigin}</span>
      </div>

      <div className="schema-viewer__toolbar">
        <button type="button" onClick={onBackToGraph}>
          Back to graph
        </button>
        <button type="button" onClick={() => void onPaste()} disabled={busy}>
          Paste
        </button>
      </div>

      <div className="schema-viewer__field-head">
        <span className="schema-viewer__label">Source schema</span>
        <div className="schema-viewer__field-actions">
          <button type="button" className="schema-viewer__icon-button" onClick={onClear} disabled={busy || !sourceText}>
            Clear
          </button>
          <button
            type="button"
            className="schema-viewer__icon-button"
            onClick={onReset}
            disabled={busy || !hasDefaultSchema}
          >
            Sample
          </button>
        </div>
      </div>

      <CodeMirror
        className="schema-viewer__code"
        value={sourceText}
        onChange={(value) => onSourceChange(value)}
        height="clamp(320px, 44vh, 520px)"
        theme={JSON_EDITOR_THEME}
        extensions={JSON_INPUT_EXTENSIONS}
        autoFocus
        spellCheck={false}
      />

      <div className="schema-viewer__actions">
        <button className="primary" type="button" onClick={onApply} disabled={busy}>
          {busy ? 'Rendering...' : 'Render schema'}
        </button>
      </div>
    </aside>
  );
}
