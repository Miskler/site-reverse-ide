import CodeMirror from '@uiw/react-codemirror';
import {
  JSON_EDITOR_THEME,
  JSON_OUTPUT_EXTENSIONS,
  JSON_POINTER_EXTENSIONS,
} from '../lib/json-editor';
import { appToast } from '../lib/app-toast';
import { InspectorShell } from '../components/InspectorShell';
import type { SelectionDetails } from './schema-types';
import { formatJsonPointerForCode } from './pointer-format';

interface DetailPanelProps {
  details: SelectionDetails | null;
  localJson: string | null;
  sourceOptions: Array<{ label: string; value: number | null }>;
  selectedSourceValue: number | null;
  onSelectSource: (value: number | null) => void;
  onClose: () => void;
}

const INSPECTOR_JSON_HEIGHT = 'clamp(160px, 26vh, 420px)';
const LOCAL_INSPECTOR_JSON_HEIGHT = 'clamp(120px, 20vh, 280px)';

function formatLocalJsonForDisplay(value: string | null, pointer: string): string {
  if (!value) {
    return '';
  }

  try {
    const unfolded = unfoldStringifiedJson(JSON.parse(value));
    const target = extractValueAtJsonPointer(unfolded, pointer);

    if (typeof target === 'undefined') {
      return '';
    }

    return JSON.stringify(target, null, 2);
  } catch {
    return value;
  }
}

function unfoldStringifiedJson(value: unknown): unknown {
  if (typeof value === 'string') {
    const text = value.trim();

    if (text.startsWith('{') || text.startsWith('[')) {
      try {
        return unfoldStringifiedJson(JSON.parse(text));
      } catch {
        return value;
      }
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => unfoldStringifiedJson(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, unfoldStringifiedJson(item)]),
    );
  }

  return value;
}

function extractValueAtJsonPointer(value: unknown, pointer: string): unknown {
  const tokens = parseJsonPointer(pointer);

  if (tokens.length === 0) {
    return value;
  }

  let current = value;

  for (const token of tokens) {
    if (Array.isArray(current)) {
      const index = Number(token);

      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return undefined;
      }

      current = current[index];
      continue;
    }

    if (current && typeof current === 'object') {
      const record = current as Record<string, unknown>;

      if (!Object.prototype.hasOwnProperty.call(record, token)) {
        return undefined;
      }

      current = record[token];
      continue;
    }

    return undefined;
  }

  return current;
}

function parseJsonPointer(pointer: string): string[] {
  const trimmed = pointer.trim();

  if (!trimmed || trimmed === '#') {
    return [];
  }

  const path = trimmed.startsWith('#/') ? trimmed.slice(2) : trimmed.startsWith('/') ? trimmed.slice(1) : '';

  if (!path) {
    return [];
  }

  return path.split('/').filter(Boolean).map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function DetailPanel({
  details,
  localJson,
  sourceOptions,
  selectedSourceValue,
  onSelectSource,
  onClose,
}: DetailPanelProps) {
  const currentDetails = details;

  if (!currentDetails) {
    return (
      <InspectorShell eyebrow="Inspector" title="Selection">
        <p className="schema-viewer__hint">
          Select a node or field in the canvas to inspect its schema fragment.
        </p>
      </InspectorShell>
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
      await navigator.clipboard.writeText(formatJsonPointerForCode(selectionDetails.jsonPointer, 'data'));
      appToast.success('JSON path copied');
    } catch {
      appToast.error('Unable to copy JSON path');
    }
  }

  return (
    <InspectorShell
      eyebrow="Inspector"
      title={selectionDetails.heading}
      badge={selectionDetails.badge}
      onAction={onClose}
      actionLabel="Close"
    >
      {selectionDetails.description ? (
        <p className="schema-viewer__description">{selectionDetails.description}</p>
      ) : null}

      {sourceOptions.length > 1 ? (
        <div className="schema-viewer__section">
          <div className="schema-viewer__section-head">
            <span className="schema-viewer__label">JSON source</span>
          </div>
          <select
            className="schema-viewer__source-select"
            value={String(selectedSourceValue ?? '')}
            onChange={(event) => {
              const rawValue = event.target.value;
              onSelectSource(rawValue === '' ? null : Number(rawValue));
            }}
          >
            {sourceOptions.map((option) => (
              <option key={option.value ?? 'all'} value={option.value === null ? '' : String(option.value)}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
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
              <button
                type="button"
                className="schema-viewer__pointer-copy"
                onClick={() => void copyJsonPointer()}
              >
                Copy code
              </button>
            </div>
            <div className="schema-viewer__pointer-code">
              <CodeMirror
                className="schema-viewer__pointer-editor"
                value={formatJsonPointerForCode(selectionDetails.jsonPointer, 'data')}
                height="2.6rem"
                theme={JSON_EDITOR_THEME}
                extensions={JSON_POINTER_EXTENSIONS}
                editable={false}
                readOnly
                basicSetup={false}
                spellCheck={false}
              />
            </div>
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
            value={formatLocalJsonForDisplay(localJson, selectionDetails.jsonPointer)}
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
    </InspectorShell>
  );
}
