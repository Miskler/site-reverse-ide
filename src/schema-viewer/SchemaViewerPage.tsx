import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { DetailPanel } from './DetailPanel';
import { SchemaCanvas } from './SchemaCanvas';
import { layoutSchemaGraph, type NodePositions } from './layout';
import { buildSchemaGraph, getSelectionDetails } from './schema-graph';
import { SAMPLE_SCHEMA } from './sample-schema';
import { appToast } from '../lib/app-toast';
import type {
  JsonSchema,
  SchemaGraphModel,
  SchemaSelection,
} from './schema-types';
import { validateSchemaDocument } from './schema-validation';

const DEFAULT_SCHEMA_TEXT = JSON.stringify(SAMPLE_SCHEMA, null, 2);

interface FocusNodeRequest {
  nodeId: string;
  token: number;
}

interface SchemaViewerPageProps {
  initialSource: string | null;
  onBackToGraph: () => void;
}

export function SchemaViewerPage({
  initialSource,
  onBackToGraph,
}: SchemaViewerPageProps) {
  const [graphModel, setGraphModel] = useState<SchemaGraphModel | null>(null);
  const [positions, setPositions] = useState<NodePositions>({});
  const [selection, setSelection] = useState<SchemaSelection | null>(null);
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  const [focusNodeRequest, setFocusNodeRequest] = useState<FocusNodeRequest | null>(null);
  const requestCounter = useRef(0);
  const focusTokenCounter = useRef(0);
  const toastCache = useRef({
    error: '',
    warning: '',
  });
  const initialSchemaText = initialSource?.trim() ? initialSource : DEFAULT_SCHEMA_TEXT;

  useEffect(() => {
    void applySchemaText(initialSchemaText);
  }, [initialSchemaText]);

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

  function parsePointerWarning(message: string): { pointer: string; description: string } | null {
    const separatorIndex = message.indexOf(': ');

    if (separatorIndex <= 0) {
      return null;
    }

    const pointer = message.slice(0, separatorIndex).trim();
    const description = message.slice(separatorIndex + 2).trim();

    if (!pointer.startsWith('#') || !description) {
      return null;
    }

    return {
      pointer,
      description,
    };
  }

  function focusSchemaPointer(pointer: string) {
    if (!graphModel) {
      return;
    }

    const node =
      Object.values(graphModel.nodeMap).find(
        (entry) => entry.pointer === pointer && entry.kind !== 'ref-target',
      ) ??
      Object.values(graphModel.nodeMap).find((entry) => entry.pointer === pointer);

    if (!node) {
      return;
    }

    const token = focusTokenCounter.current + 1;
    focusTokenCounter.current = token;

    setSelection({ kind: 'node', nodeId: node.id });
    setFocusNodeRequest({ nodeId: node.id, token });
  }

  function showSchemaWarning(message: string) {
    const parsed = parsePointerWarning(message);

    if (!parsed) {
      appToast.warning(message, undefined, {
        toastId: `schema-warning:${message}`,
      });
      return;
    }

    const toastId = `schema-warning:${message}`;

    appToast.warning(
      <button
        type="button"
        className="app-toast__link"
        onClick={() => {
          appToast.dismiss(toastId);
          focusSchemaPointer(parsed.pointer);
        }}
      >
        {parsed.pointer}
      </button>,
      parsed.description,
      { toastId },
    );
  }

  async function applySchemaText(text: string) {
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
        setFocusNodeRequest(null);
        setBusy(false);
        setRevision((value) => value + 1);
      });

      resetToastCache();

      if (model.warnings.length > 0) {
        model.warnings.forEach((warning) => {
          showSchemaWarning(warning);
        });
      }
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

  return (
    <div className="schema-viewer-shell">
      <div className="schema-viewer-shell__topbar">
        <div className="schema-viewer-shell__topbar-copy">
          <p className="schema-viewer__eyebrow">Schema Viewer</p>
          <h1 className="schema-viewer__title schema-viewer__title--compact">JSON Schema Viewer</h1>
        </div>

        <button type="button" onClick={onBackToGraph}>
          Back to graph
        </button>
      </div>

      <main className="schema-viewer-shell__canvas">
        {graphModel ? (
          <SchemaCanvas
            model={graphModel}
            positions={positions}
            selection={selection}
            revision={revision}
            focusNodeRequest={focusNodeRequest}
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
