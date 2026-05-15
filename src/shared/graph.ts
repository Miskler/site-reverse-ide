export const GRAPH_VERSION = 3;
export const STORAGE_KEY = 'site-reverse-ide:graph-v2';

const LEGACY_GRAPH_VERSIONS = new Set([2]);

export const HTTP_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'localStorage',
  'cookies',
  'sessionStorage',
] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

const HTTP_METHOD_LOOKUP = new Map(
  HTTP_METHODS.map((method) => [method.toLowerCase(), method] as const),
);

export const DEFAULT_NODE_COLORS = [
  '#2f8f83',
  '#ef7d57',
  '#d9a441',
  '#5f7cff',
  '#b85fe4',
  '#5b8c57',
  '#db5d8f',
];

export interface GraphPosition {
  x: number;
  y: number;
}

export interface GraphNode {
  id: string;
  uid: string;
  method: HttpMethod;
  title: string;
  note: string;
  color: string;
  rawJsons: string[];
  position: GraphPosition;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface GraphDocument {
  version: typeof GRAPH_VERSION;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const DEFAULT_NODE_SIZE = {
  width: 264,
  height: 168,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function createNodeUid(): string {
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(3);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 6)
    .toUpperCase();
}

export function normalizeNodeUid(value: unknown, fallback = createNodeUid()): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const text = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(text)) {
    return fallback;
  }

  return text;
}

export function normalizeSourceJsonList(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => normalizeText(item, ''))
      .filter((item) => item.length > 0);

    if (items.length > 0) {
      return items;
    }
  }

  if (typeof value === 'string') {
    const text = normalizeText(value, '');
    if (text.length > 0) {
      return [text];
    }
  }

  return [...fallback];
}

export function createNodeRawJson(input: {
  method: HttpMethod;
  title: string;
  note: string;
}): string {
  return JSON.stringify(
    {
      method: input.method,
      title: input.title,
      description: input.note,
    },
    null,
    2,
  );
}

export function createId(prefix: string): string {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function pickNodeColor(index: number): string {
  return DEFAULT_NODE_COLORS[index % DEFAULT_NODE_COLORS.length];
}

export function normalizeText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const text = value.trim();
  return text.length > 0 ? text : fallback;
}

export function normalizeColor(value: unknown, fallback = DEFAULT_NODE_COLORS[0]): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const text = value.trim();
  if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(text)) {
    return fallback;
  }

  return text;
}

export function normalizeHttpMethod(value: unknown, fallback: HttpMethod = 'GET'): HttpMethod {
  if (typeof value !== 'string') {
    return fallback;
  }

  const method = HTTP_METHOD_LOOKUP.get(value.trim().toLowerCase());
  return method ?? fallback;
}

export function normalizePosition(
  value: unknown,
  fallback: GraphPosition = { x: 0, y: 0 },
): GraphPosition {
  if (!isRecord(value)) {
    return fallback;
  }

  const x = typeof value.x === 'number' && Number.isFinite(value.x) ? value.x : fallback.x;
  const y = typeof value.y === 'number' && Number.isFinite(value.y) ? value.y : fallback.y;
  return { x, y };
}

export function createNodeDraft(input: {
  id?: string;
  uid?: unknown;
  method?: unknown;
  title?: unknown;
  note?: unknown;
  color?: unknown;
  rawJson?: unknown;
  rawJsons?: unknown;
  position?: unknown;
  index: number;
}): GraphNode {
  const method = normalizeHttpMethod(input.method);
  const title = normalizeText(input.title, `Функция ${input.index + 1}`);
  const note = normalizeText(input.note, 'Коротко опиши назначение функции.');
  const color = normalizeColor(input.color, pickNodeColor(input.index));
  const fallbackRawJson = createNodeRawJson({ method, title, note });
  const rawJsons = normalizeSourceJsonList(
    input.rawJsons,
    normalizeSourceJsonList(input.rawJson, [fallbackRawJson]),
  );

  return {
    id: normalizeText(input.id, createId('node')),
    uid: normalizeNodeUid(input.uid),
    method,
    title,
    note,
    color,
    rawJsons,
    position: normalizePosition(input.position, {
      x: 120 + input.index * 24,
      y: 120 + input.index * 16,
    }),
  };
}

export function createEdgeDraft(input: {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: unknown;
  targetHandle?: unknown;
  existingEdges?: GraphEdge[];
}): GraphEdge | null {
  const source = normalizeText(input.source, '');
  const target = normalizeText(input.target, '');
  if (!source || !target || source === target) {
    return null;
  }

  const existingEdges = input.existingEdges ?? [];
  if (existingEdges.some((edge) => edge.source === source && edge.target === target)) {
    return null;
  }

  return {
    id: normalizeText(input.id, createId('edge')),
    source,
    target,
    sourceHandle: normalizeText(input.sourceHandle, 'source') || 'source',
    targetHandle: normalizeText(input.targetHandle, 'target') || 'target',
  };
}

export function countNodeLinks(graph: GraphDocument, nodeId: string): number {
  let total = 0;
  for (const edge of graph.edges) {
    if (edge.source === nodeId || edge.target === nodeId) {
      total += 1;
    }
  }
  return total;
}

export function createDefaultGraph(): GraphDocument {
  return {
    version: GRAPH_VERSION,
    nodes: [
      createNodeDraft({
        id: 'node-start',
        method: 'GET',
        title: 'Список',
        note: 'Читает данные и возвращает список.',
        color: '#2f8f83',
        position: { x: 140, y: 140 },
        index: 0,
      }),
      createNodeDraft({
        id: 'node-middle',
        method: 'POST',
        title: 'Создание',
        note: 'Создаёт новую запись или запускает действие.',
        color: '#ef7d57',
        position: { x: 468, y: 274 },
        index: 1,
      }),
      createNodeDraft({
        id: 'node-end',
        method: 'PATCH',
        title: 'Обновление',
        note: 'Меняет существующее состояние и возвращает результат.',
        color: '#d9a441',
        position: { x: 806, y: 156 },
        index: 2,
      }),
    ],
    edges: [
      createEdgeDraft({
        id: 'edge-start-middle',
        source: 'node-start',
        target: 'node-middle',
      }),
      createEdgeDraft({
        id: 'edge-middle-end',
        source: 'node-middle',
        target: 'node-end',
      }),
    ].filter((edge): edge is GraphEdge => Boolean(edge)),
  };
}

export function sanitizeGraphDocument(input: unknown): GraphDocument {
  if (
    !isRecord(input) ||
    (input.version !== GRAPH_VERSION && !LEGACY_GRAPH_VERSIONS.has(Number(input.version)))
  ) {
    return createDefaultGraph();
  }

  const rawNodes = Array.isArray(input.nodes) ? input.nodes : [];
  const nodes: GraphNode[] = [];
  const seenNodeIds = new Set<string>();
  const seenNodeUids = new Set<string>();

  rawNodes.forEach((rawNode, index) => {
    if (!isRecord(rawNode)) {
      return;
    }

    const id = normalizeText(rawNode.id, '');
    if (!id || seenNodeIds.has(id)) {
      return;
    }

    seenNodeIds.add(id);

    const node = createNodeDraft({
      id,
      uid: rawNode.uid,
      method: rawNode.method,
      title: rawNode.title,
      note: rawNode.note,
      color: rawNode.color,
      rawJson: rawNode.rawJson,
      rawJsons: rawNode.rawJsons,
      position: rawNode.position,
      index,
    });

    while (seenNodeUids.has(node.uid)) {
      node.uid = createNodeUid();
    }

    seenNodeUids.add(node.uid);
    nodes.push(node);
  });

  if (nodes.length === 0) {
    return createDefaultGraph();
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const rawEdges = Array.isArray(input.edges) ? input.edges : [];
  const edges: GraphEdge[] = [];
  const seenEdgeIds = new Set<string>();
  const seenPairs = new Set<string>();

  rawEdges.forEach((rawEdge) => {
    if (!isRecord(rawEdge)) {
      return;
    }

    const id = normalizeText(rawEdge.id, '');
    const source = normalizeText(rawEdge.source, '');
    const target = normalizeText(rawEdge.target, '');

    if (!id || !source || !target) {
      return;
    }

    if (seenEdgeIds.has(id) || source === target || !nodeIds.has(source) || !nodeIds.has(target)) {
      return;
    }

    const pairKey = `${source}::${target}`;
    if (seenPairs.has(pairKey)) {
      return;
    }

    seenEdgeIds.add(id);
    seenPairs.add(pairKey);
    edges.push({
      id,
      source,
      target,
      sourceHandle: normalizeText(rawEdge.sourceHandle, 'source') || 'source',
      targetHandle: normalizeText(rawEdge.targetHandle, 'target') || 'target',
    });
  });

  return {
    version: GRAPH_VERSION,
    nodes,
    edges,
  };
}

export function getDefaultCanvasSize(): GraphPosition {
  return {
    x: DEFAULT_NODE_SIZE.width,
    y: DEFAULT_NODE_SIZE.height,
  };
}
