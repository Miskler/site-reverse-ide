import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { DetailPanel } from './DetailPanel';
import { SchemaCanvas } from './SchemaCanvas';
import { layoutSchemaGraph, type NodePositions } from './layout';
import { buildSchemaGraph, getSelectionDetails } from './schema-graph';
import { validateSchemaDocument } from './schema-validation';
import { appToast } from '../lib/app-toast';
import {
  STORAGE_KEY,
  createDefaultGraph,
  createNodeRawJson,
  sanitizeGraphDocument,
  type GraphDocument,
} from '../shared/graph';
import type { JsonSchema, SchemaGraphModel, SchemaSelection } from './schema-types';

interface FocusNodeRequest {
  nodeId: string;
  token: number;
}

interface SchemaViewerPageProps {
  nodeUid: string;
  jsonIndex: number | null;
  onBackToGraph: () => void;
}

const api = {
  async loadGraph(): Promise<unknown> {
    const response = await fetch('/api/graph', {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to load graph (${response.status})`);
    }

    return response.json();
  },
  async generateSchema(documents: string[]): Promise<JsonSchema> {
    const response = await fetch(buildGenschemaUrl('/api/genschema'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        documents,
        use_default_comparators: true,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error || `Failed to generate schema (${response.status})`);
    }

    const payload = (await response.json()) as { schema?: unknown };
    if (
      !payload ||
      typeof payload !== 'object' ||
      !payload.schema ||
      typeof payload.schema !== 'object' ||
      Array.isArray(payload.schema)
    ) {
      throw new Error('Malformed schema response');
    }

    return payload.schema as JsonSchema;
  },
};

function buildGenschemaUrl(pathname: string): string {
  const baseUrl = import.meta.env.VITE_GENSCHEMA_URL?.trim() || 'http://127.0.0.1:8000';
  return new URL(pathname, baseUrl).toString();
}

export function SchemaViewerPage({
  nodeUid,
  jsonIndex,
  onBackToGraph,
}: SchemaViewerPageProps) {
  const [graphModel, setGraphModel] = useState<SchemaGraphModel | null>(null);
  const [positions, setPositions] = useState<NodePositions>({});
  const [selection, setSelection] = useState<SchemaSelection | null>(null);
  const [busy, setBusy] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [focusNodeRequest, setFocusNodeRequest] = useState<FocusNodeRequest | null>(null);
  const requestCounter = useRef(0);
  const focusTokenCounter = useRef(0);
  const toastCache = useRef({
    error: '',
    warning: '',
  });

  useEffect(() => {
    void loadNodeSchema();
  }, [jsonIndex, nodeUid]);

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

  async function applySchemaDocument(schema: JsonSchema, request: number) {
    const validation = validateSchemaDocument(schema);

    if (!validation.valid) {
      if (request !== requestCounter.current) {
        return;
      }

      setBusy(false);
      setLoadError('Schema document is not valid.');
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
        setLoadError(null);
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
      setLoadError('Unable to build schema graph.');
      showSchemaToast('error', [
        error instanceof Error ? error.message : 'Unable to build schema graph.',
      ]);
    }
  }

  async function loadNodeSchema() {
    const request = requestCounter.current + 1;
    requestCounter.current = request;

    setBusy(true);
    setLoadError(null);
    setGraphModel(null);
    setPositions({});
    setSelection(null);
    setFocusNodeRequest(null);
    resetToastCache();

    try {
      const graph = await loadGraphDocument();

      if (request !== requestCounter.current) {
        return;
      }

      const node = findGraphNode(graph, nodeUid);
      if (!node) {
        setBusy(false);
        setLoadError(`Node #${nodeUid} was not found.`);
        showSchemaToast('error', [`Node #${nodeUid} was not found.`]);
        return;
      }

      const documents = resolveNodeDocuments(node, jsonIndex);
      if (documents.length === 0) {
        const message =
          jsonIndex === null
            ? `Node #${nodeUid} has no JSON sources to render.`
            : `Source ${jsonIndex + 1} was not found for node #${nodeUid}.`;

        setBusy(false);
        setLoadError(message);
        showSchemaToast('error', [message]);
        return;
      }

      const schema = await api.generateSchema(documents);

      if (request !== requestCounter.current) {
        return;
      }

      await applySchemaDocument(schema, request);
    } catch (error) {
      if (request !== requestCounter.current) {
        return;
      }

      setBusy(false);
      const message = error instanceof Error ? error.message : 'Unable to load node schema.';
      setLoadError(message);
      showSchemaToast('error', [message]);
    }
  }

  return (
    <div className="schema-viewer-shell">
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
            {loadError
              ? loadError
              : busy
                ? 'Loading schema...'
                : 'Render a schema to see the diagram.'}
          </div>
        )}
      </main>

      <DetailPanel details={details} onClose={() => setSelection(null)} />
    </div>
  );
}

function readCachedGraphDocument(): GraphDocument | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    return sanitizeGraphDocument(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

async function loadGraphDocument(): Promise<GraphDocument> {
  try {
    const remote = await api.loadGraph();
    const graph = sanitizeGraphDocument(remote);

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(graph));
    }

    return graph;
  } catch (error) {
    console.warn('Schema viewer graph load failed, using cache', error);

    return readCachedGraphDocument() ?? createDefaultGraph();
  }
}

function findGraphNode(graph: GraphDocument, nodeUid: string) {
  return (
    graph.nodes.find((node) => node.uid === nodeUid) ??
    graph.nodes.find((node) => node.id === nodeUid) ??
    null
  );
}

function resolveNodeDocuments(
  node: GraphDocument['nodes'][number],
  jsonIndex: number | null,
): string[] {
  const sources =
    node.rawJsons.length > 0
      ? node.rawJsons
      : [
          createNodeRawJson({
            method: node.method,
            title: node.title,
            note: node.note,
          }),
        ];

  if (jsonIndex === null) {
    return sources;
  }

  const source = sources[jsonIndex];
  return source ? [source] : [];
}
