import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useId,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type ReactFlowInstance,
} from '@xyflow/react';
import {
  HTTP_METHODS,
  STORAGE_KEY,
  createDefaultGraph,
  createEdgeDraft,
  createId,
  createNodeDraft,
  createNodeRawJson,
  pickNodeColor,
  normalizeHttpMethod,
  normalizeText,
  sanitizeGraphDocument,
  type GraphDocument,
  type GraphEdge,
  type GraphNode,
  type HttpMethod,
} from './shared/graph';
import { CanvasEdge } from './components/CanvasEdge';
import { ColorPicker } from './components/ColorPicker';
import { CanvasNode, type CanvasNodeType } from './components/CanvasNode';

type StatusTone = 'neutral' | 'success' | 'warning';

type FlowEdge = Edge;

type DialogState =
  | {
      kind: 'schema-generator';
      nodeId: string;
      rawJson: string;
      generatedSchema: string;
      error: string | null;
      isGenerating: boolean;
    }
  | {
      kind: 'color';
      nodeId: string;
      color: string;
      originalColor: string;
    }
  | {
      kind: 'confirm-delete';
      target: 'node' | 'edge';
      id: string;
      label: string;
    }
  | null;

const nodeTypes = {
  canvasNode: CanvasNode,
};

const edgeTypes = {
  canvasEdge: CanvasEdge,
};

const JSON_HIGHLIGHT_STYLE = HighlightStyle.define(
  [
    { tag: t.propertyName, class: 'schema-generator__token--property-name' },
    { tag: t.string, class: 'schema-generator__token--string' },
    { tag: t.number, class: 'schema-generator__token--number' },
    { tag: t.bool, class: 'schema-generator__token--boolean' },
    { tag: t.null, class: 'schema-generator__token--null' },
    { tag: [t.brace, t.squareBracket, t.separator], class: 'schema-generator__token--punctuation' },
  ],
  { themeType: 'dark' },
);

const JSON_EDITOR_THEME = EditorView.theme(
  {
    '&': {
      backgroundColor: '#101726',
      color: '#e5eef7',
    },
    '.cm-scroller': {
      fontFamily:
        '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
      fontSize: '0.88rem',
      lineHeight: '1.55',
    },
    '.cm-content': {
      caretColor: '#ffffff',
      padding: '0.95rem 1rem',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: '#ffffff',
    },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      {
        backgroundColor: 'rgba(76, 137, 255, 0.22) !important',
      },
    '.cm-activeLine': {
      backgroundColor: 'rgba(255, 255, 255, 0.03)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'rgba(255, 255, 255, 0.03)',
    },
    '.cm-gutters': {
      backgroundColor: '#0d1521',
      color: '#9aa7b8',
      borderRight: '1px solid rgba(255, 255, 255, 0.08)',
    },
    '.cm-tooltip': {
      backgroundColor: '#111b2a',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      color: '#edf4ff',
    },
  },
  { dark: true },
);

const JSON_EXTENSIONS = [json(), syntaxHighlighting(JSON_HIGHLIGHT_STYLE)];
const SCHEMA_EDITOR_HEIGHT = 'clamp(320px, 45vh, 520px)';

const DEFAULT_GENSCHEMA_BASE_URL = 'http://127.0.0.1:8000';
const configuredGenschemaBaseUrl = import.meta.env.VITE_GENSCHEMA_URL?.trim();
const GENSCHEMA_API_URL = (() => {
  try {
    return new URL('/api/genschema', configuredGenschemaBaseUrl || DEFAULT_GENSCHEMA_BASE_URL).toString();
  } catch {
    return new URL('/api/genschema', DEFAULT_GENSCHEMA_BASE_URL).toString();
  }
})();
const GENSCHEMA_BASE_URL = new URL(GENSCHEMA_API_URL).origin;

type GenschemaResponse = {
  schema: unknown;
  meta?: {
    inputs?: number;
    comparators?: string[];
    base_of?: string;
    pseudo_array?: boolean;
    postprocessed?: boolean;
  };
};

function formatGeneratedSchema(schema: unknown): string {
  if (typeof schema === 'string') {
    const trimmed = schema.trim();
    if (!trimmed) {
      return '';
    }

    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return schema;
    }
  }

  return JSON.stringify(schema, null, 2);
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
  async generateSchema(sample: unknown): Promise<GenschemaResponse> {
    const response = await fetch(GENSCHEMA_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        documents: [sample],
        use_default_comparators: true,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string; detail?: string };
      throw new Error(payload.error || payload.detail || `Failed to generate schema (${response.status})`);
    }

    return response.json() as Promise<GenschemaResponse>;
  },
  async saveGraph(graph: GraphDocument): Promise<GraphDocument> {
    const response = await fetch('/api/graph', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(graph),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error || `Failed to save graph (${response.status})`);
    }

    return response.json();
  },
};

export function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState('Загрузка графа...');
  const [statusTone, setStatusTone] = useState<StatusTone>('neutral');
  const [hydrated, setHydrated] = useState(false);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<CanvasNodeType, FlowEdge> | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const saveRequestIdRef = useRef(0);
  const schemaGenerationRequestRef = useRef(0);
  const statusTimerRef = useRef<number | null>(null);
  const fittedRef = useRef(false);
  const dialogRef = useRef(dialog);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const connectMode = true;
  const schemaGeneratorNodeId = dialog?.kind === 'schema-generator' ? dialog.nodeId : null;

  useEffect(() => {
    dialogRef.current = dialog;
  }, [dialog]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  useEffect(() => {
    if (dialog?.kind !== 'schema-generator') {
      return;
    }

    return () => {
      schemaGenerationRequestRef.current += 1;
    };
  }, [schemaGeneratorNodeId]);

  useEffect(() => {
    void loadInitialGraph();
  }, []);

  useEffect(() => {
    if (!selectedNodeId) {
      return;
    }

    if (!nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [nodes, selectedNodeId]);

  useEffect(() => {
    if (!selectedEdgeId) {
      return;
    }

    if (!edges.some((edge) => edge.id === selectedEdgeId)) {
      setSelectedEdgeId(null);
    }
  }, [edges, selectedEdgeId]);

  useEffect(() => {
    if (!dialog) {
      return;
    }

    if (dialog.kind === 'schema-generator' || dialog.kind === 'color') {
      if (!nodes.some((node) => node.id === dialog.nodeId)) {
        setDialog(null);
      }
      return;
    }

    const exists = dialog.target === 'node'
      ? nodes.some((node) => node.id === dialog.id)
      : edges.some((edge) => edge.id === dialog.id);

    if (!exists) {
      setDialog(null);
    }
  }, [dialog, edges, nodes]);

  useEffect(() => {
    if (!dialog) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDialog(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dialog]);

  useEffect(() => {
    if (!hydrated || fittedRef.current || !reactFlowInstance || nodes.length === 0) {
      return;
    }

    fittedRef.current = true;
    requestAnimationFrame(() => {
      reactFlowInstance.fitView({
        padding: 0.18,
        duration: 300,
      });
    });
  }, [hydrated, nodes.length, reactFlowInstance]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
      if (statusTimerRef.current) {
        window.clearTimeout(statusTimerRef.current);
      }
    };
  }, []);

  async function loadInitialGraph() {
    try {
      const remote = await api.loadGraph();
      const nextGraph = sanitizeGraphDocument(remote);
      applyDocument(nextGraph, { preserveSelection: false });
      setStatus('Граф загружен из сервера');
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextGraph));
    } catch (error) {
      console.warn('Server graph load failed, using local cache', error);

      const cached = readCachedGraph();
      const nextGraph = cached ?? createDefaultGraph();
      applyDocument(nextGraph, { preserveSelection: false });
      setStatus(cached ? 'Граф загружен из локального кэша' : 'Создан новый demo-граф');
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextGraph));
    } finally {
      setHydrated(true);
    }
  }

  function readCachedGraph(): GraphDocument | null {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }

      return sanitizeGraphDocument(JSON.parse(raw) as unknown);
    } catch (error) {
      console.warn('Invalid cached graph', error);
      return null;
    }
  }

  function setStatus(message: string, tone: StatusTone = 'neutral') {
    setStatusText(message);
    setStatusTone(tone);

    if (statusTimerRef.current) {
      window.clearTimeout(statusTimerRef.current);
    }

    statusTimerRef.current = window.setTimeout(() => {
      setStatusText('Готов к работе');
      setStatusTone('neutral');
    }, 2800);
  }

  function composeDocument(nextNodes: CanvasNodeType[], nextEdges: FlowEdge[]): GraphDocument {
    return {
      version: 2,
      nodes: nextNodes.map((node) => ({
        id: node.id,
        method: node.data.method,
        title: node.data.title,
        note: node.data.note,
        color: node.data.color,
        rawJson:
          node.data.rawJson.trim() ||
          createNodeRawJson({
            method: node.data.method,
            title: node.data.title,
            note: node.data.note,
          }),
        position: node.position,
      })),
      edges: nextEdges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle ?? undefined,
        targetHandle: edge.targetHandle ?? undefined,
      })),
    };
  }

  function buildFlowNodes(document: GraphDocument): CanvasNodeType[] {
    const linkCounts = new Map<string, number>();

    for (const edge of document.edges) {
      linkCounts.set(edge.source, (linkCounts.get(edge.source) ?? 0) + 1);
      linkCounts.set(edge.target, (linkCounts.get(edge.target) ?? 0) + 1);
    }

    return document.nodes.map((node) => {
      const { position, ...nodeData } = node;

      return {
        id: node.id,
        type: 'canvasNode',
        position,
        data: {
          ...nodeData,
          connectMode,
          linkCount: linkCounts.get(node.id) ?? 0,
          onRequestDelete: requestDeleteNode,
          onOpenEditor: requestOpenNodeDetails,
          onOpenColorPicker: requestOpenNodeColor,
          onUpdateNode: updateNodeById,
        },
        draggable: true,
        dragHandle: '.graph-node__drag-handle',
        selectable: true,
      };
    });
  }

  function buildFlowEdges(document: GraphDocument): FlowEdge[] {
    return document.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'canvasEdge',
      sourceHandle: edge.sourceHandle ?? 'source',
      targetHandle: edge.targetHandle ?? 'target',
    }));
  }

  function applyDocument(document: GraphDocument, options?: { preserveSelection?: boolean; selectFirst?: boolean }) {
    const nextNodes = buildFlowNodes(document);
    const nextEdges = buildFlowEdges(document);

    setNodes(nextNodes);
    setEdges(nextEdges);

    if (!options?.preserveSelection) {
      if (options?.selectFirst) {
        setSelectedNodeId(nextNodes[0]?.id ?? null);
      } else {
        setSelectedNodeId(null);
      }
      setSelectedEdgeId(null);
    }
  }

  function scheduleSave(nextNodes: CanvasNodeType[], nextEdges: FlowEdge[], message: string, tone: StatusTone = 'success') {
    const document = composeDocument(nextNodes, nextEdges);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
    const saveRequestId = ++saveRequestIdRef.current;

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(async () => {
      try {
        const saved = sanitizeGraphDocument(await api.saveGraph(document));
        if (saveRequestId !== saveRequestIdRef.current) {
          return;
        }

        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
        setStatus(message, tone);
      } catch (error) {
        if (saveRequestId !== saveRequestIdRef.current) {
          return;
        }

        console.warn('Save failed', error);
        setStatus('Сохранил в браузере, сервер пока недоступен', 'warning');
      }
    }, 220);
  }

  function getCanvasCenter() {
    if (!canvasRef.current || !reactFlowInstance) {
      return { x: 180, y: 180 };
    }

    const rect = canvasRef.current.getBoundingClientRect();
    return reactFlowInstance.screenToFlowPosition({
      x: rect.width / 2,
      y: rect.height / 2,
    });
  }

  function addNodeAt(position?: { x: number; y: number }) {
    const index = nodesRef.current.length;
    const draft = createNodeDraft({
      id: createId('node'),
      method: HTTP_METHODS[0],
      title: `Функция ${index + 1}`,
      note: 'Коротко опиши назначение функции.',
      color: pickNodeColor(index),
      position: position ?? getCanvasCenter(),
      index,
    });
    const { position: draftPosition, ...draftData } = draft;

    const newNode: CanvasNodeType = {
      id: draft.id,
      type: 'canvasNode',
      position: draftPosition,
      data: {
        ...draftData,
        connectMode,
        linkCount: 0,
        onRequestDelete: requestDeleteNode,
        onOpenEditor: requestOpenNodeDetails,
        onOpenColorPicker: requestOpenNodeColor,
        onUpdateNode: updateNodeById,
      },
      draggable: true,
      dragHandle: '.graph-node__drag-handle',
      selectable: true,
    };

    const nextNodes = [...nodesRef.current, newNode];
    const nextEdges = edgesRef.current;

    setNodes(nextNodes);
    setSelectedNodeId(newNode.id);
    setSelectedEdgeId(null);
    scheduleSave(nextNodes, nextEdges, 'Функция добавлена');
  }

  function handleAddNodeClick() {
    addNodeAt();
  }

  function handlePaneDoubleClick(event: ReactMouseEvent) {
    const target = event.target as HTMLElement;
    if (
      target.closest('.graph-node') ||
      target.closest('button') ||
      target.closest('.canvas-frame__topbar') ||
      target.closest('.react-flow__controls')
    ) {
      return;
    }

    if (!reactFlowInstance) {
      return;
    }

    addNodeAt(
      reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      }),
    );
  }

  function handleNodeDragStop(_: ReactMouseEvent, node: CanvasNodeType) {
    const nextNodes = nodesRef.current.map((current) =>
      current.id === node.id
        ? {
            ...current,
            position: {
              x: node.position.x,
              y: node.position.y,
            },
          }
        : current,
    );

    scheduleSave(nextNodes, edgesRef.current, 'Функция перемещена');
    setSelectedNodeId(node.id);
  }

  function handleConnect(connection: Connection) {
    if (!connection.source || !connection.target) {
      return;
    }

    const existingEdges = edgesRef.current.filter(
      (edge) => edge.source === connection.source && edge.target === connection.target,
    );

    if (existingEdges.length > 0) {
      const nextEdges = edgesRef.current.filter(
        (edge) => !(edge.source === connection.source && edge.target === connection.target),
      );
      setEdges(nextEdges);
      if (existingEdges.some((edge) => edge.id === selectedEdgeId)) {
        setSelectedEdgeId(null);
      }
      scheduleSave(nodesRef.current, nextEdges, 'Связь сброшена');
      return;
    }

    const edge = createEdgeDraft({
      id: createId('edge'),
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.targetHandle,
      existingEdges: edgesRef.current.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
      })),
    });

    if (!edge) {
      setStatus('Нельзя создать такую связь', 'warning');
      return;
    }

    const nextEdges = [...edgesRef.current, edge];
    setEdges(nextEdges);
    scheduleSave(nodesRef.current, nextEdges, 'Связь добавлена');
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
  }

  function handleDeleteNode(nodeId: string) {
    const nextNodes = nodesRef.current.filter((node) => node.id !== nodeId);
    const nextEdges = edgesRef.current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);

    setNodes(nextNodes);
    setEdges(nextEdges);

    if (selectedNodeId === nodeId) {
      setSelectedNodeId(null);
    }
    if (selectedEdgeId && !nextEdges.some((edge) => edge.id === selectedEdgeId)) {
      setSelectedEdgeId(null);
    }

    scheduleSave(nextNodes, nextEdges, 'Функция удалена');
  }

  function handleDeleteEdge(edgeId: string) {
    const nextEdges = edgesRef.current.filter((edge) => edge.id !== edgeId);

    setEdges(nextEdges);

    if (selectedEdgeId === edgeId) {
      setSelectedEdgeId(null);
    }

    scheduleSave(nodesRef.current, nextEdges, 'Связь удалена');
  }

  const requestOpenNodeDetails = useCallback((nodeId: string) => {
    const node = nodesRef.current.find((current) => current.id === nodeId);
    if (!node) {
      return;
    }

    const rawJson =
      node.data.rawJson.trim() ||
      createNodeRawJson({
        method: node.data.method,
        title: node.data.title,
        note: node.data.note,
      });

    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
    setDialog({
      kind: 'schema-generator',
      nodeId,
      rawJson,
      generatedSchema: '',
      error: null,
      isGenerating: false,
    });
  }, []);

  const requestOpenNodeColor = useCallback((nodeId: string) => {
    const node = nodesRef.current.find((current) => current.id === nodeId);
    if (!node) {
      return;
    }

    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
    setDialog({
      kind: 'color',
      nodeId,
      color: node.data.color,
      originalColor: node.data.color,
    });
  }, []);

  const requestDeleteNode = useCallback((nodeId: string) => {
    const node = nodesRef.current.find((current) => current.id === nodeId);
    if (!node) {
      return;
    }

    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
    setDialog({
      kind: 'confirm-delete',
      target: 'node',
      id: nodeId,
      label: node.data.title.trim() || 'Без названия',
    });
  }, []);

  const requestDeleteEdge = useCallback((edgeId: string) => {
    const edge = edgesRef.current.find((current) => current.id === edgeId);
    if (!edge) {
      return;
    }

    setSelectedEdgeId(edgeId);
    setSelectedNodeId(null);
    setDialog({
      kind: 'confirm-delete',
      target: 'edge',
      id: edgeId,
      label: formatEdgeLabel(nodesRef.current, edge),
    });
  }, []);

  const confirmDelete = useCallback(() => {
    if (!dialog || dialog.kind !== 'confirm-delete') {
      return;
    }

    if (dialog.target === 'node') {
      handleDeleteNode(dialog.id);
    } else {
      handleDeleteEdge(dialog.id);
    }

    setDialog(null);
  }, [dialog]);

  const previewNodeColor = useCallback((nodeId: string, color: string) => {
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.id !== nodeId) {
          return node;
        }

        return {
          ...node,
          data: {
            ...node.data,
            color,
          },
        };
      }),
    );
  }, []);

  const closeDialog = useCallback(() => {
    const current = dialogRef.current;
    if (current?.kind === 'color') {
      previewNodeColor(current.nodeId, current.originalColor);
    } else if (current?.kind === 'schema-generator') {
      persistSchemaGeneratorRawJson();
    }

    setDialog(null);
  }, [previewNodeColor]);

  function updateSchemaGeneratorRawJson(rawJson: string) {
    setDialog((current) =>
      current && current.kind === 'schema-generator'
        ? {
            ...current,
            rawJson,
            generatedSchema: '',
            error: null,
          }
        : current,
    );
  }

  function persistSchemaGeneratorRawJson() {
    const current = dialogRef.current;
    if (!current || current.kind !== 'schema-generator') {
      return;
    }

    const node = nodesRef.current.find((candidate) => candidate.id === current.nodeId);
    if (!node || node.data.rawJson === current.rawJson) {
      return;
    }

    updateNodeById(current.nodeId, { rawJson: current.rawJson });
  }

  async function generateSchemaFromRawJson() {
    const current = dialogRef.current;
    if (!current || current.kind !== 'schema-generator') {
      return;
    }

    persistSchemaGeneratorRawJson();

    let parsedSample: unknown;
    try {
      parsedSample = JSON.parse(current.rawJson);
    } catch {
      setDialog((dialogState) =>
        dialogState && dialogState.kind === 'schema-generator'
          ? {
              ...dialogState,
              error: 'Сырой JSON должен быть валидным. Исправь синтаксис и попробуй снова.',
              isGenerating: false,
            }
          : dialogState,
      );
      setStatus('JSON нужно исправить перед генерацией', 'warning');
      return;
    }

    const requestId = ++schemaGenerationRequestRef.current;

    setDialog((dialogState) =>
      dialogState && dialogState.kind === 'schema-generator'
        ? {
            ...dialogState,
            error: null,
            isGenerating: true,
          }
        : dialogState,
    );

    try {
      const response = await api.generateSchema(parsedSample);
      if (schemaGenerationRequestRef.current !== requestId) {
        return;
      }

      const formattedSchema = formatGeneratedSchema(response.schema);
      setDialog((dialogState) =>
        dialogState && dialogState.kind === 'schema-generator'
          ? {
              ...dialogState,
              generatedSchema: formattedSchema,
              error: null,
              isGenerating: false,
            }
          : dialogState,
      );
      setStatus('Схема сгенерирована через Python backend', 'success');
    } catch (error) {
      if (schemaGenerationRequestRef.current !== requestId) {
        return;
      }

      const message = error instanceof Error ? error.message : 'Не удалось сгенерировать схему';
      setDialog((dialogState) =>
        dialogState && dialogState.kind === 'schema-generator'
          ? {
              ...dialogState,
              error: message,
              isGenerating: false,
            }
          : dialogState,
      );
      setStatus(message, 'warning');
    }
  }

  function requestDeleteSelection() {
    if (selectedNodeId) {
      requestDeleteNode(selectedNodeId);
      return;
    }

    if (selectedEdgeId) {
      requestDeleteEdge(selectedEdgeId);
      return;
    }

    setStatus('Нечего удалять', 'warning');
  }

  function resetDemo() {
    const nextGraph = createDefaultGraph();
    applyDocument(nextGraph, { selectFirst: true });
    fittedRef.current = false;
    requestAnimationFrame(() => {
      reactFlowInstance?.fitView({
        padding: 0.18,
        duration: 300,
      });
      fittedRef.current = true;
    });
    scheduleSave(buildFlowNodes(nextGraph), buildFlowEdges(nextGraph), 'Демо восстановлено');
    setStatus('Демо восстановлено');
  }

  function handleSelectionChange({
    nodes: selectedNodes,
    edges: selectedEdges,
  }: {
    nodes: CanvasNodeType[];
    edges: FlowEdge[];
  }) {
    setSelectedNodeId(selectedNodes[0]?.id ?? null);
    setSelectedEdgeId(selectedEdges[0]?.id ?? null);
  }

  function updateNodeById(
    nodeId: string,
    patch: Partial<Pick<GraphNode, 'method' | 'title' | 'note' | 'color' | 'rawJson'>>,
  ) {
    const nextNodes = nodesRef.current.map((node) => {
      if (node.id !== nodeId) {
        return node;
      }

      return {
        ...node,
        data: {
          ...node.data,
          method: patch.method !== undefined ? normalizeHttpMethod(patch.method, node.data.method) : node.data.method,
          title: patch.title !== undefined ? patch.title : node.data.title,
          note: patch.note !== undefined ? patch.note : node.data.note,
          color: patch.color !== undefined ? patch.color : node.data.color,
          rawJson:
            patch.rawJson !== undefined ? normalizeText(patch.rawJson, node.data.rawJson) : node.data.rawJson,
        },
      };
    });

    setNodes(nextNodes);
    scheduleSave(nextNodes, edgesRef.current, 'Параметры функции обновлены');
  }

  const linkCounts = useMemo(() => {
    const map = new Map<string, number>();

    for (const edge of edges) {
      map.set(edge.source, (map.get(edge.source) ?? 0) + 1);
      map.set(edge.target, (map.get(edge.target) ?? 0) + 1);
    }

    return map;
  }, [edges]);

  const flowNodes: CanvasNodeType[] = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          connectMode,
          linkCount: linkCounts.get(node.id) ?? 0,
          onRequestDelete: requestDeleteNode,
          onOpenEditor: requestOpenNodeDetails,
          onOpenColorPicker: requestOpenNodeColor,
          onUpdateNode: updateNodeById,
        },
      })),
    [linkCounts, nodes, requestDeleteNode, requestOpenNodeColor, requestOpenNodeDetails, updateNodeById],
  );

  const flowEdges: FlowEdge[] = useMemo(() => edges.map((edge) => ({ ...edge })), [edges]);

  return (
    <div className="app-shell">
      <main className="workspace-shell">
        <div className="canvas-frame" ref={canvasRef} onDoubleClick={handlePaneDoubleClick}>
          <div className="canvas-frame__topbar">
          <div className="canvas-frame__actions">
              <span className={`badge tone-${statusTone}`}>{statusText}</span>
              <span className="canvas-pill">
                {nodes.length} функций · {edges.length} связей
              </span>
              <button className="primary" type="button" onClick={handleAddNodeClick}>
                Добавить функцию
              </button>
              <button type="button" className="danger" onClick={requestDeleteSelection}>
                Удалить выбранное
              </button>
              <button type="button" onClick={resetDemo}>
                Сбросить demo
              </button>
            </div>
          </div>

          <ReactFlow<CanvasNodeType, FlowEdge>
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onInit={setReactFlowInstance}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onSelectionChange={handleSelectionChange}
            onNodeClick={(_: ReactMouseEvent, node) => {
              setSelectedNodeId(node.id);
              setSelectedEdgeId(null);
            }}
            onNodeDragStop={handleNodeDragStop}
            onEdgeClick={(_: ReactMouseEvent, edge) => {
              setSelectedEdgeId(edge.id);
              setSelectedNodeId(null);
            }}
            onPaneClick={() => {
              setSelectedNodeId(null);
              setSelectedEdgeId(null);
            }}
            onConnect={handleConnect}
            nodesConnectable
            nodesDraggable
            deleteKeyCode={null}
            panOnDrag
            panOnScroll={false}
            panActivationKeyCode="Control"
            zoomOnScroll
            defaultEdgeOptions={{
              type: 'canvasEdge',
            }}
            className="canvas-flow"
          >
            <Background variant={BackgroundVariant.Lines} gap={24} lineWidth={0.75} />
            <Controls />
          </ReactFlow>
        </div>
      </main>

      {dialog?.kind === 'schema-generator' ? (
        <DialogShell title="Генератор схемы JSON" onClose={closeDialog} className="dialog-shell--schema">
          <form
            className="dialog-form dialog-form--schema"
            onSubmit={(event) => {
              event.preventDefault();
              void generateSchemaFromRawJson();
            }}
          >
            <div className="schema-generator__grid">
              <label className="dialog-field dialog-field--code schema-generator__pane">
                <span>Сырой JSON</span>
                <CodeMirror
                  className="schema-generator__code-mirror schema-generator__code-mirror--input"
                  value={dialog.rawJson}
                  onChange={(value) => updateSchemaGeneratorRawJson(value)}
                  autoFocus
                  height={SCHEMA_EDITOR_HEIGHT}
                  theme={JSON_EDITOR_THEME}
                  extensions={JSON_EXTENSIONS}
                  placeholder={`{\n  "name": "Alice",\n  "email": "alice@example.com"\n}`}
                  spellCheck={false}
                />
                <small className="dialog-hint">Можно вставить объект, массив или любое другое валидное JSON-значение.</small>
              </label>

              <div className="schema-generator__pane">
                <div className="dialog-field dialog-field--code">
                  <span>Схема</span>
                  <CodeMirror
                    className="schema-generator__code-mirror schema-generator__code-mirror--output"
                    value={dialog.generatedSchema || ''}
                    height={SCHEMA_EDITOR_HEIGHT}
                    theme={JSON_EDITOR_THEME}
                    extensions={JSON_EXTENSIONS}
                    editable={false}
                    readOnly
                    basicSetup={false}
                    placeholder="Нажми «Сгенерировать схему», чтобы увидеть результат."
                    spellCheck={false}
                  />
                </div>

                {dialog.error ? (
                  <div className="dialog-feedback dialog-feedback--error">{dialog.error}</div>
                ) : (
                  <p className="helper">
                    Ответ приходит от Python API `genschema` на `{GENSCHEMA_BASE_URL}`.
                  </p>
                )}
              </div>
            </div>

            <div className="dialog-actions dialog-actions--spread">
              <span className="dialog-status">
                {dialog.isGenerating
                  ? 'Генерирую схему...'
                  : dialog.generatedSchema
                    ? 'Схема готова'
                    : 'Готов к генерации'}
              </span>
              <div className="dialog-actions__buttons">
                <button type="button" onClick={closeDialog}>
                  Отмена
                </button>
                <button type="submit" className="primary" disabled={dialog.isGenerating}>
                  {dialog.isGenerating ? 'Генерирую...' : 'Сгенерировать схему'}
                </button>
              </div>
            </div>
          </form>
        </DialogShell>
      ) : null}

      {dialog?.kind === 'color' ? (
        <DialogShell
          title="Цвет"
          onClose={closeDialog}
          className="dialog-shell--wide dialog-shell--color-picker"
        >
          <form
            className="dialog-form dialog-form--color-picker"
            onSubmit={(event) => {
              event.preventDefault();
              updateNodeById(dialog.nodeId, {
                color: dialog.color,
              });
              setDialog(null);
            }}
          >
            <ColorPicker
              value={dialog.color}
              onChange={(nextColor) => {
                flushSync(() => {
                  previewNodeColor(dialog.nodeId, nextColor);
                  setDialog((current) =>
                    current && current.kind === 'color' ? { ...current, color: nextColor } : current,
                  );
                });
              }}
            />

            <div className="dialog-actions">
              <button type="button" onClick={closeDialog}>
                Отмена
              </button>
              <button type="submit" className="primary">
                Сохранить
              </button>
            </div>
          </form>
        </DialogShell>
      ) : null}

      {dialog?.kind === 'confirm-delete' ? (
        <DialogShell
          title="Удаление"
          onClose={closeDialog}
          className="dialog-shell--compact"
        >
          <div className="dialog-confirm">
            <p>
              {dialog.target === 'node'
                ? `Удалить функцию «${dialog.label}»? Связи тоже удалятся.`
                : `Удалить связь «${dialog.label}»?`}
            </p>
          </div>

          <div className="dialog-actions">
            <button type="button" onClick={closeDialog}>
              Отмена
            </button>
            <button type="button" className="danger" onClick={confirmDelete}>
              Удалить
            </button>
          </div>
        </DialogShell>
      ) : null}
    </div>
  );
}

function DialogShell({
  title,
  onClose,
  children,
  className,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const titleId = useId();

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={() => {
        onClose();
      }}
    >
      <section
        className={`dialog-shell ${className ?? ''}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="dialog-shell__header">
          <h3 id={titleId}>{title}</h3>
          <button type="button" className="dialog-shell__close" aria-label="Закрыть окно" onClick={onClose}>
            ×
          </button>
        </div>

        {children}
      </section>
    </div>
  );
}

function formatEdgeLabel(nodes: CanvasNodeType[], edge: FlowEdge) {
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);

  if (!source || !target) {
    return 'Связь: одна из функций уже удалена';
  }

  return `Связь: ${source.data.title} → ${target.data.title}`;
}

