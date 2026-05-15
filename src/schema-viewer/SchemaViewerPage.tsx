import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { DetailPanel } from './DetailPanel';
import { SchemaCanvas } from './SchemaCanvas';
import { SchemaSourcePanel } from './SchemaSourcePanel';
import { layoutSchemaGraph, type NodePositions } from './layout';
import { buildSchemaGraph, getSelectionDetails } from './schema-graph';
import { SAMPLE_SCHEMA } from './sample-schema';
import { storeSchemaSource } from '../lib/app-router';
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
  const [warnings, setWarnings] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  const requestCounter = useRef(0);

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

  async function applySchemaText(text: string, origin: string) {
    const request = requestCounter.current + 1;
    requestCounter.current = request;

    const trimmed = text.trim();

    if (!trimmed) {
      if (request !== requestCounter.current) {
        return;
      }

      setBusy(false);
      setErrors(['Schema input is empty.']);
      setWarnings([]);
      setGraphModel(null);
      setPositions({});
      setSelection(null);
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
      setErrors([
        error instanceof Error ? error.message : 'Schema input is not valid JSON.',
      ]);
      setWarnings([]);
      return;
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      if (request !== requestCounter.current) {
        return;
      }

      setBusy(false);
      setErrors(['JSON Schema viewer expects the root value to be a JSON object.']);
      setWarnings([]);
      return;
    }

    const schema = parsed as JsonSchema;
    const validation = validateSchemaDocument(schema);

    if (!validation.valid) {
      if (request !== requestCounter.current) {
        return;
      }

      setBusy(false);
      setErrors(validation.errors);
      setWarnings([]);
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
        setWarnings(model.warnings);
        setErrors([]);
        setSourceOrigin(origin);
        setBusy(false);
        setRevision((value) => value + 1);
      });

      storeSchemaSource(text);
    } catch (error) {
      if (request !== requestCounter.current) {
        return;
      }

      setBusy(false);
      setErrors([
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
      setErrors([
        'Clipboard paste is unavailable in this browser context. Use a secure origin or paste manually.',
      ]);
      return;
    }

    try {
      const clipboardText = await navigator.clipboard.readText();
      if (!clipboardText.trim()) {
        setErrors(['Clipboard is empty. Copy a JSON Schema document and try again.']);
        return;
      }

      handleSourceChange(clipboardText);
    } catch (error) {
      setErrors([
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
    setWarnings([]);
    setErrors([]);
    storeSchemaSource('');
  }

  function handleReset() {
    setSourceText(DEFAULT_SCHEMA_TEXT);
    setSourceOrigin('Sample schema');
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
        errors={errors}
        warnings={warnings}
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
