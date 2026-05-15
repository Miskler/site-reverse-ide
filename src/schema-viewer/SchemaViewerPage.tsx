import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { DetailPanel } from './DetailPanel';
import { SchemaCanvas } from './SchemaCanvas';
import { SchemaSourcePanel } from './SchemaSourcePanel';
import { layoutSchemaGraph, type NodePositions } from './layout';
import { buildSchemaGraph, getSelectionDetails } from './schema-graph';
import { SAMPLE_SCHEMA } from './sample-schema';
import { storeSchemaSource } from '../lib/app-router';
import { appToast } from '../lib/app-toast';
import type {
  JsonSchema,
  SchemaGraphModel,
  SchemaSelection,
} from './schema-types';
import { validateSchemaDocument } from './schema-validation';

const DEFAULT_SCHEMA_TEXT = JSON.stringify(SAMPLE_SCHEMA, null, 2);

interface SchemaViewerPageProps {
  initialSource: string | null;
  onBackToGraph: () => void;
}

export function SchemaViewerPage({
  initialSource,
  onBackToGraph,
}: SchemaViewerPageProps) {
  const [sourceText, setSourceText] = useState(
    initialSource?.trim() ? initialSource : DEFAULT_SCHEMA_TEXT,
  );
  const [sourceOrigin, setSourceOrigin] = useState(
    initialSource?.trim() ? 'Route input' : 'Sample schema',
  );
  const [graphModel, setGraphModel] = useState<SchemaGraphModel | null>(null);
  const [positions, setPositions] = useState<NodePositions>({});
  const [selection, setSelection] = useState<SchemaSelection | null>(null);
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  const requestCounter = useRef(0);
  const toastCache = useRef({
    error: '',
    warning: '',
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void applySchemaText(sourceText, sourceOrigin);
    }, 180);

    return () => window.clearTimeout(timer);
  }, [sourceText]);

  const details = useMemo(
    () => (graphModel ? getSelectionDetails(graphModel, selection) : null),
    [graphModel, selection],
  );

  function resetToastCache() {
    toastCache.current.error = '';
    toastCache.current.warning = '';
  }

  function showSchemaToast(kind: 'error' | 'warning', messages: string[]) {
    if (messages.length === 0) {
      return;
    }

    const signature = `${kind}:${messages.join('\u001f')}`;

    if (toastCache.current[kind] === signature) {
      return;
    }

    toastCache.current[kind] = signature;

    const [primary, ...rest] = messages;
    const description = rest.length > 0 ? rest.join('; ') : undefined;

    if (kind === 'error') {
      appToast.error(primary, description);
      return;
    }

    appToast.warning(primary, description);
  }

  async function applySchemaText(text: string, origin: string) {
    const request = requestCounter.current + 1;
    requestCounter.current = request;

    const trimmed = text.trim();

    if (!trimmed) {
      if (request !== requestCounter.current) {
        return;
      }

      setBusy(false);
      setGraphModel(null);
      setPositions({});
      setSelection(null);
      resetToastCache();
      return;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(text);
    } catch (error) {
      if (request !== requestCounter.current) {
        return;
      }

      setBusy(false);
      showSchemaToast('error', [
        error instanceof Error ? error.message : 'Schema input is not valid JSON.',
      ]);
      return;
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      if (request !== requestCounter.current) {
        return;
      }

      setBusy(false);
      showSchemaToast('error', ['JSON Schema viewer expects the root value to be a JSON object.']);
      return;
    }

    const schema = parsed as JsonSchema;
    const validation = validateSchemaDocument(schema);

    if (!validation.valid) {
      if (request !== requestCounter.current) {
        return;
      }

      setBusy(false);
      showSchemaToast('error', validation.errors);
      return;
    }

    setBusy(true);

    try {
      const model = buildSchemaGraph(schema);
      const nextPositions = await layoutSchemaGraph(model);

      if (request !== requestCounter.current) {
        return;
      }

      startTransition(() => {
        setGraphModel(model);
        setPositions(nextPositions);
        setSelection(null);
        setSourceOrigin(origin);
        setBusy(false);
        setRevision((value) => value + 1);
      });

      resetToastCache();

      if (model.warnings.length > 0) {
        showSchemaToast('warning', model.warnings);
      }

      storeSchemaSource(text);
    } catch (error) {
      if (request !== requestCounter.current) {
        return;
      }

      setBusy(false);
      showSchemaToast('error', [
        error instanceof Error ? error.message : 'Unable to build schema graph.',
      ]);
    }
  }

  function handleSourceChange(value: string) {
    setSourceText(value);
    setSourceOrigin('Draft');
    storeSchemaSource(value);
  }

  async function handlePaste() {
    if (!navigator.clipboard?.readText) {
      showSchemaToast('error', [
        'Clipboard paste is unavailable in this browser context. Use a secure origin or paste manually.',
      ]);
      return;
    }

    try {
      const clipboardText = await navigator.clipboard.readText();
      if (!clipboardText.trim()) {
        showSchemaToast('error', ['Clipboard is empty. Copy a JSON Schema document and try again.']);
        return;
      }

      resetToastCache();
      handleSourceChange(clipboardText);
      appToast.message('Schema pasted from clipboard');
    } catch (error) {
      showSchemaToast('error', [
        error instanceof Error
          ? `Unable to read clipboard: ${error.message}`
          : 'Unable to read clipboard.',
      ]);
    }
  }

  function handleClear() {
    setSourceText('');
    setSourceOrigin('Draft');
    setGraphModel(null);
    setPositions({});
    setSelection(null);
    resetToastCache();
    storeSchemaSource('');
    appToast.message('Schema cleared');
  }

  function handleReset() {
    setSourceText(DEFAULT_SCHEMA_TEXT);
    setSourceOrigin('Sample schema');
    resetToastCache();
    appToast.message('Sample schema loaded');
  }

  function handleApply() {
    void applySchemaText(sourceText, sourceOrigin || 'Draft');
  }

  return (
    <div className="schema-viewer-shell">
      <SchemaSourcePanel
        sourceText={sourceText}
        sourceOrigin={sourceOrigin}
        busy={busy}
        hasDefaultSchema={Boolean(DEFAULT_SCHEMA_TEXT)}
        onBackToGraph={onBackToGraph}
        onSourceChange={handleSourceChange}
        onPaste={() => void handlePaste()}
        onClear={handleClear}
        onApply={handleApply}
        onReset={handleReset}
      />

      <main className="schema-viewer-shell__canvas">
        {graphModel ? (
          <SchemaCanvas
            model={graphModel}
            positions={positions}
            selection={selection}
            revision={revision}
            onSelectNode={(nodeId) => setSelection({ kind: 'node', nodeId })}
            onSelectRow={(nodeId, rowId) => setSelection({ kind: 'row', nodeId, rowId })}
            onClearSelection={() => setSelection(null)}
          />
        ) : (
          <div className="schema-viewer-shell__empty">
            Render a schema to see the diagram.
          </div>
        )}
      </main>

      <DetailPanel details={details} onClose={() => setSelection(null)} />
    </div>
  );
}
