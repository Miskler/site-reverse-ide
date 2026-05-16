import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { DetailPanel } from './DetailPanel';
import { SchemaCanvas } from './SchemaCanvas';
import { layoutSchemaGraph, type NodePositions } from './layout';
import { buildSchemaGraph, getSelectionDetails } from './schema-graph';
import { validateSchemaDocument } from './schema-validation';
import { appToast } from '../lib/app-toast';
import { readIntegerCookie, writeCookie } from '../lib/cookies';
import { buildGenschemaUrl } from '../lib/genschema';
import { loadGraphDocument } from '../lib/graph-store';
import {
  createNodeRawJson,
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
}

const api = {
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

const DETAILS_PANEL_WIDTH_COOKIE = 'site-reverse-ide-schema-viewer-details-width';
const DETAILS_PANEL_DEFAULT_WIDTH = 340;
const DETAILS_PANEL_MIN_WIDTH = 260;
const DETAILS_PANEL_MAX_WIDTH = 680;
const DETAILS_PANEL_MIN_CANVAS_WIDTH = 420;
const DETAILS_PANEL_RESIZER_WIDTH = 8;
const DETAILS_PANEL_KEY_STEP = 24;
const DETAILS_PANEL_KEY_STEP_FAST = 72;

export function SchemaViewerPage({
  nodeUid,
  jsonIndex,
}: SchemaViewerPageProps) {
  const [detailsWidth, setDetailsWidth] = useState<number>(() =>
    getInitialDetailsWidth(),
  );
  const [graphDocument, setGraphDocument] = useState<GraphDocument | null>(null);
  const [graphModel, setGraphModel] = useState<SchemaGraphModel | null>(null);
  const [positions, setPositions] = useState<NodePositions>({});
  const [selection, setSelection] = useState<SchemaSelection | null>(null);
  const [busy, setBusy] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [localJson, setLocalJson] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [focusNodeRequest, setFocusNodeRequest] = useState<FocusNodeRequest | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const requestCounter = useRef(0);
  const focusTokenCounter = useRef(0);
  const resizeSessionRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
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

  const shellStyle = useMemo<CSSProperties>(
    () =>
      ({
        '--schema-viewer-details-width': `${detailsWidth}px`,
      }) as CSSProperties,
    [detailsWidth],
  );

  useEffect(() => {
    writeCookie(DETAILS_PANEL_WIDTH_COOKIE, String(detailsWidth), {
      maxAgeSeconds: 60 * 60 * 24 * 365,
      path: '/',
      sameSite: 'Lax',
    });
  }, [detailsWidth]);

  useEffect(() => {
    const handleWindowResize = () => {
      setDetailsWidth((current) => clampWidthForViewport(current, window.innerWidth));
    };

    handleWindowResize();
    window.addEventListener('resize', handleWindowResize);

    return () => window.removeEventListener('resize', handleWindowResize);
  }, []);

  useEffect(
    () => () => {
      resizeCleanupRef.current?.();
      resizeCleanupRef.current = null;
    },
    [],
  );

  function resetToastCache() {
    toastCache.current.error = '';
    toastCache.current.warning = '';
  }

  function clampDetailsWidth(value: number, viewportWidth: number): number {
    const maxWidth = Math.max(
      DETAILS_PANEL_MIN_WIDTH,
      Math.min(DETAILS_PANEL_MAX_WIDTH, viewportWidth - DETAILS_PANEL_MIN_CANVAS_WIDTH),
    );

    return Math.round(Math.max(DETAILS_PANEL_MIN_WIDTH, Math.min(maxWidth, value)));
  }

  function setAndPersistDetailsWidth(nextWidth: number) {
    const viewportWidth = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerWidth;
    const nextValue = clampDetailsWidth(nextWidth, viewportWidth);
    setDetailsWidth(nextValue);
  }

  function getKeyboardResizeStep(event: ReactKeyboardEvent<HTMLDivElement>): number {
    return event.shiftKey ? DETAILS_PANEL_KEY_STEP_FAST : DETAILS_PANEL_KEY_STEP;
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

    const focusNodeId =
      node.isEmbedded && node.ownerNodeId !== node.id ? node.ownerNodeId : node.id;
    const token = focusTokenCounter.current + 1;
    focusTokenCounter.current = token;

    setSelection({ kind: 'node', nodeId: node.id });
    setFocusNodeRequest({ nodeId: focusNodeId, token });
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

  function handleResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();

    const session = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: detailsWidth,
    };

    resizeSessionRef.current = session;
    setIsResizing(true);

    const stopResize = () => {
      if (resizeSessionRef.current?.pointerId !== session.pointerId) {
        return;
      }

      resizeSessionRef.current = null;
      setIsResizing(false);
      resizeCleanupRef.current?.();
      resizeCleanupRef.current = null;
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== session.pointerId) {
        return;
      }

      const nextWidth = session.startWidth + (session.startX - moveEvent.clientX);
      setAndPersistDetailsWidth(nextWidth);
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== session.pointerId) {
        return;
      }

      stopResize();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    resizeCleanupRef.current = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };

    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function handleResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = getKeyboardResizeStep(event);

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setAndPersistDetailsWidth(detailsWidth - step);
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setAndPersistDetailsWidth(detailsWidth + step);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      setAndPersistDetailsWidth(DETAILS_PANEL_MIN_WIDTH);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      const viewportWidth = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerWidth;
      const maxWidth = Math.max(
        DETAILS_PANEL_MIN_WIDTH,
        Math.min(DETAILS_PANEL_MAX_WIDTH, viewportWidth - DETAILS_PANEL_MIN_CANVAS_WIDTH),
      );
      setAndPersistDetailsWidth(maxWidth);
    }
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
    setLocalJson(null);
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

      setGraphDocument(graph);

      const node = findGraphNode(graph, nodeUid);
      if (!node) {
        setBusy(false);
        setLoadError(`Node #${nodeUid} was not found.`);
        showSchemaToast('error', [`Node #${nodeUid} was not found.`]);
        return;
      }

      const documents = resolveNodeDocuments(node, jsonIndex);
      setLocalJson(resolveNodeLocalJson(node, jsonIndex));
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
    <div
      className={`schema-viewer-shell${isResizing ? ' schema-viewer-shell--resizing' : ''}`}
      style={shellStyle}
    >
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

      <div
        className={`schema-viewer-shell__resizer${isResizing ? ' is-resizing' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize inspector panel"
        aria-valuemin={DETAILS_PANEL_MIN_WIDTH}
        aria-valuemax={Math.max(
          DETAILS_PANEL_MIN_WIDTH,
          Math.min(
            DETAILS_PANEL_MAX_WIDTH,
            (typeof window === 'undefined' ? DETAILS_PANEL_MAX_WIDTH : window.innerWidth) -
              DETAILS_PANEL_MIN_CANVAS_WIDTH,
          ),
        )}
        aria-valuenow={detailsWidth}
        tabIndex={0}
        onKeyDown={handleResizeKeyDown}
        onPointerDown={handleResizePointerDown}
      />

      <DetailPanel
        details={details}
        localJson={localJson}
        onClose={() => setSelection(null)}
      />
    </div>
  );
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

function resolveNodeLocalJson(
  node: GraphDocument['nodes'][number],
  jsonIndex: number | null,
): string | null {
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

  if (sources.length === 0) {
    return null;
  }

  if (jsonIndex === null) {
    return sources[0] ?? null;
  }

  return sources[jsonIndex] ?? sources[0] ?? null;
}

function getInitialDetailsWidth(): number {
  const storedWidth = readIntegerCookie(DETAILS_PANEL_WIDTH_COOKIE);
  const viewportWidth = typeof window === 'undefined' ? DETAILS_PANEL_DEFAULT_WIDTH : window.innerWidth;
  const fallbackWidth = storedWidth ?? DETAILS_PANEL_DEFAULT_WIDTH;

  return clampWidthForViewport(fallbackWidth, viewportWidth);
}

function clampWidthForViewport(value: number, viewportWidth: number): number {
  const maxWidth = Math.max(
    DETAILS_PANEL_MIN_WIDTH,
    Math.min(DETAILS_PANEL_MAX_WIDTH, viewportWidth - DETAILS_PANEL_MIN_CANVAS_WIDTH),
  );

  return Math.round(Math.max(DETAILS_PANEL_MIN_WIDTH, Math.min(maxWidth, value)));
}
