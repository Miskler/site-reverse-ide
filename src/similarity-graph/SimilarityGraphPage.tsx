import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  getBezierPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react';
import { buildGenschemaUrl } from '../lib/genschema';
import type { GraphDocument } from '../shared/graph';
import { createNodeRawJson, normalizeText } from '../shared/graph';

interface SimilarityGraphPageProps {
  graph: GraphDocument | null;
  busy: boolean;
  loadError: string | null;
  onGoToGraph: () => void;
  onNavigateSchemaNode: (nodeUid: string, jsonIndex?: number | null) => void;
}

interface SimilaritySource {
  requestIndex: number;
  nodeUid: string;
  nodeTitle: string;
  nodeMethod: string;
  nodeColor: string;
  variantIndex: number;
  variantLabel: string;
  label: string;
  rawJson: string;
  summary: string;
  byteSize: number;
  totalVariants: number;
}

interface SimilarityGraphNodeMetadata {
  index: number;
  kind: string;
  source: string | null;
  path: string | null;
  structural_tokens: number;
  total_keys: number;
  postprocessed: boolean;
}

interface SimilarityGraphNodePayload {
  id: string;
  label: string;
  description: string;
  position: {
    x: number;
    y: number;
  };
  metadata: SimilarityGraphNodeMetadata;
}

interface SimilarityGraphEdgeStats {
  ADDED: number;
  DELETED: number;
  REPLACED: number;
  MODIFIED: number;
  NO_DIFF: number;
  UNKNOWN: number;
}

interface SimilarityGraphEdgePayload {
  id: string;
  source: string;
  target: string;
  kind: string;
  score: number;
  percentage: number;
  label: string;
  structure_score: number;
  diff_score: number;
  stats: SimilarityGraphEdgeStats;
  metadata: {
    structure_weight: number;
    diff_weight: number;
    shared_tokens: number;
    left_tokens: number;
    right_tokens: number;
  };
}

interface SimilarityGraphResponse {
  nodes: SimilarityGraphNodePayload[];
  edges: SimilarityGraphEdgePayload[];
  meta: {
    inputs: number;
    pairs: number;
    complete_graph: boolean;
    base_of: string;
    pseudo_array: boolean;
    use_default_comparators: boolean;
    comparators: string[];
    default_comparators: Array<{ name: string; attribute?: string }>;
    postprocessed: boolean;
    include_schema: boolean;
    score_weights: {
      structure: number;
      diff: number;
    };
    score_formula: string;
  };
}

interface SimilarityNodeData extends Record<string, unknown> {
  label: string;
  description: string;
  summary: string;
  nodeTitle: string;
  nodeUid: string;
  variantLabel: string;
  metadata: SimilarityGraphNodeMetadata;
  strength: number;
  neighborCount: number;
}

interface SimilarityEdgeData extends Record<string, unknown> {
  score: number;
  percentage: number;
  structureScore: number;
  diffScore: number;
  stats: SimilarityGraphEdgeStats;
}

type SimilarityNodeType = Node<SimilarityNodeData, 'similarityNode'>;
type SimilarityEdgeType = Edge<SimilarityEdgeData, 'similarityEdge'>;

const SOURCE_NODE_WIDTH = 220;
const SOURCE_NODE_HEIGHT = 110;
const MIN_GRAPH_THRESHOLD = 0.1;
const MAX_GRAPH_THRESHOLD = 0.95;
const DEFAULT_GRAPH_THRESHOLD = 0.55;
const DEFAULT_STRUCTURE_WEIGHT = 0.7;
const DEFAULT_LAYOUT_SCALE = 1;
const DEFAULT_FOCUS_ZOOM = 1.08;

const nodeTypes = {
  similarityNode: SimilarityNode,
};

const edgeTypes = {
  similarityEdge: SimilarityEdge,
};

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatByteSize(rawJson: string): string {
  const bytes =
    typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(rawJson).length : rawJson.length;

  if (bytes < 1024) {
    return `${Math.max(1, bytes)} B`;
  }

  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) {
    return `${Math.max(1, Math.round(kilobytes))} KB`;
  }

  return `${Math.max(1, Math.round(kilobytes / 1024))} MB`;
}

function summarizeRawJson(rawJson: string): string {
  const compact = rawJson.trim().replace(/\s+/g, ' ');
  if (!compact) {
    return 'Пустой JSON';
  }

  return compact.length > 96 ? `${compact.slice(0, 96)}…` : compact;
}

function formatVariantLabel(index: number): string {
  switch (index) {
    case 0:
      return 'основной';
    case 1:
      return 'вариант 2';
    case 2:
      return 'вариант 3';
    default:
      return `вариант ${index + 1}`;
  }
}

function formatNodeTitle(value: string, fallback: string): string {
  const text = normalizeText(value, '');
  return text || fallback;
}

function buildSimilaritySources(graph: GraphDocument | null): SimilaritySource[] {
  if (!graph) {
    return [];
  }

  const sources: SimilaritySource[] = [];

  graph.nodes.forEach((node) => {
    const baseTitle = formatNodeTitle(node.title, node.uid);
    const rawJsons =
      node.rawJsons.length > 0
        ? node.rawJsons
        : [
            createNodeRawJson({
              method: node.method,
              title: node.title,
              note: node.note,
            }),
          ];

    rawJsons.forEach((rawJson, variantIndex) => {
      sources.push({
        requestIndex: sources.length,
        nodeUid: node.uid,
        nodeTitle: baseTitle,
        nodeMethod: node.method,
        nodeColor: node.color,
        variantIndex,
        variantLabel: formatVariantLabel(variantIndex),
        label: rawJsons.length > 1 ? `${baseTitle} · ${formatVariantLabel(variantIndex)}` : baseTitle,
        rawJson,
        summary: summarizeRawJson(rawJson),
        byteSize: typeof TextEncoder !== 'undefined'
          ? new TextEncoder().encode(rawJson).length
          : rawJson.length,
        totalVariants: rawJsons.length,
      });
    });
  });

  return sources;
}

function buildSimilarityUrl(): string {
  return buildGenschemaUrl('/api/genschema/similarity-graph');
}

function mapNodeStrengths(edges: SimilarityGraphEdgePayload[]): Map<string, { count: number; strongest: number }> {
  const map = new Map<string, { count: number; strongest: number }>();

  for (const edge of edges) {
    const left = map.get(edge.source) ?? { count: 0, strongest: 0 };
    const right = map.get(edge.target) ?? { count: 0, strongest: 0 };

    left.count += 1;
    right.count += 1;
    left.strongest = Math.max(left.strongest, edge.score);
    right.strongest = Math.max(right.strongest, edge.score);

    map.set(edge.source, left);
    map.set(edge.target, right);
  }

  return map;
}

function clampThreshold(value: number): number {
  return Math.max(MIN_GRAPH_THRESHOLD, Math.min(MAX_GRAPH_THRESHOLD, value));
}

function scaleLayoutPosition(
  position: { x: number; y: number },
  scale: number,
): { x: number; y: number } {
  return {
    x: position.x * scale - SOURCE_NODE_WIDTH / 2,
    y: position.y * scale - SOURCE_NODE_HEIGHT / 2,
  };
}

export function SimilarityGraphPage({
  graph,
  busy,
  loadError,
  onGoToGraph,
  onNavigateSchemaNode,
}: SimilarityGraphPageProps) {
  const [graphResponse, setGraphResponse] = useState<SimilarityGraphResponse | null>(null);
  const [graphBusy, setGraphBusy] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(DEFAULT_GRAPH_THRESHOLD);
  const [structureWeight, setStructureWeight] = useState(DEFAULT_STRUCTURE_WEIGHT);
  const [refreshToken, setRefreshToken] = useState(0);
  const reactFlowRef = useRef<ReactFlowInstance<SimilarityNodeType, SimilarityEdgeType> | null>(null);
  const requestTokenRef = useRef(0);

  const sources = useMemo(() => buildSimilaritySources(graph), [graph]);
  const requestPayload = useMemo(
    () => ({
      documents: sources.map((source) => ({
        kind: 'json',
        label: source.label,
        value: source.rawJson,
      })),
      use_default_comparators: true,
      base_of: 'anyOf',
      pseudo_array: true,
      include_schema: false,
      structure_weight: structureWeight,
      diff_weight: 1 - structureWeight,
    }),
    [sources, structureWeight],
  );

  useEffect(() => {
    if (!graph) {
      setGraphResponse(null);
      setGraphError(loadError ?? null);
      setGraphBusy(false);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      return;
    }

    if (sources.length < 2) {
      setGraphResponse(null);
      setGraphError('Нужны хотя бы два JSON-источника, чтобы построить карту связей.');
      setGraphBusy(false);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      return;
    }

    const currentRequestToken = requestTokenRef.current + 1;
    requestTokenRef.current = currentRequestToken;
    setGraphBusy(true);
    setGraphError(null);

    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch(buildSimilarityUrl(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(requestPayload),
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error || `Failed to build similarity graph (${response.status})`);
        }

        const payload = (await response.json()) as SimilarityGraphResponse;

        if (requestTokenRef.current !== currentRequestToken) {
          return;
        }

        setGraphResponse(payload);
        setGraphError(null);
      } catch (error) {
        if (requestTokenRef.current !== currentRequestToken) {
          return;
        }

        const message = error instanceof Error ? error.message : 'Не удалось собрать граф связей.';
        setGraphResponse(null);
        setGraphError(message);
      } finally {
        if (requestTokenRef.current === currentRequestToken) {
          setGraphBusy(false);
        }
      }
    }, 120);

    return () => window.clearTimeout(timeoutId);
  }, [graph, loadError, refreshToken, requestPayload, sources.length]);

  const visibleEdges = useMemo(() => {
    if (!graphResponse) {
      return [];
    }

    return graphResponse.edges
      .filter((edge) => edge.score >= threshold)
      .sort((left, right) => right.score - left.score);
  }, [graphResponse, threshold]);

  const nodeStrengths = useMemo(() => mapNodeStrengths(visibleEdges), [visibleEdges]);
  const layoutScale = useMemo(() => {
    const nodeCount = graphResponse?.nodes.length ?? 0;
    if (nodeCount <= 8) {
      return DEFAULT_LAYOUT_SCALE;
    }

    return Math.min(2.1, DEFAULT_LAYOUT_SCALE + (nodeCount - 8) * 0.06);
  }, [graphResponse?.nodes.length]);

  const flowNodes: SimilarityNodeType[] = useMemo(() => {
    if (!graphResponse) {
      return [];
    }

    return graphResponse.nodes.map((node) => {
      const source = sources[node.metadata.index];
      const strength = nodeStrengths.get(node.id)?.strongest ?? 0;
      const neighborCount = nodeStrengths.get(node.id)?.count ?? 0;

      return {
        id: node.id,
        type: 'similarityNode',
        position: scaleLayoutPosition(node.position, layoutScale),
        data: {
          label: node.label,
          description: node.description,
          summary: source?.summary ?? node.description,
          nodeTitle: source?.nodeTitle ?? node.label,
          nodeUid: source?.nodeUid ?? node.id,
          variantLabel: source?.variantLabel ?? 'основной',
          metadata: node.metadata,
          strength,
          neighborCount,
        },
        draggable: false,
        selectable: true,
        style: {
          width: `${SOURCE_NODE_WIDTH}px`,
        },
      };
    });
  }, [graphResponse, layoutScale, nodeStrengths, sources]);

  const flowEdges: SimilarityEdgeType[] = useMemo(() => {
    return visibleEdges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'similarityEdge',
      data: {
        score: edge.score,
        percentage: edge.percentage,
        structureScore: edge.structure_score,
        diffScore: edge.diff_score,
        stats: edge.stats,
      },
      selectable: true,
    }));
  }, [visibleEdges]);

  const selectedNode = useMemo(
    () => flowNodes.find((node) => node.id === selectedNodeId) ?? null,
    [flowNodes, selectedNodeId],
  );

  const selectedEdge = useMemo(
    () => visibleEdges.find((edge) => edge.id === selectedEdgeId) ?? null,
    [selectedEdgeId, visibleEdges],
  );

  const selectedSource = useMemo(() => {
    if (!selectedNode) {
      return null;
    }

    return sources[selectedNode.data.metadata.index] ?? null;
  }, [selectedNode, sources]);

  const selectedNodeConnections = useMemo(() => {
    if (!selectedNodeId) {
      return [];
    }

    return visibleEdges
      .filter((edge) => edge.source === selectedNodeId || edge.target === selectedNodeId)
      .sort((left, right) => right.score - left.score)
      .slice(0, 6);
  }, [selectedNodeId, visibleEdges]);

  const strongestEdge = useMemo(() => {
    if (visibleEdges.length === 0) {
      return null;
    }

    return visibleEdges[0];
  }, [visibleEdges]);

  const averageScore = useMemo(() => {
    if (visibleEdges.length === 0) {
      return 0;
    }

    return visibleEdges.reduce((sum, edge) => sum + edge.score, 0) / visibleEdges.length;
  }, [visibleEdges]);

  const activeEdge = selectedEdge ?? strongestEdge;

  function focusFlowNode(nodeId: string) {
    const node = flowNodes.find((current) => current.id === nodeId);
    if (!node || !reactFlowRef.current) {
      return;
    }

    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);

    reactFlowRef.current.setCenter(
      node.position.x + SOURCE_NODE_WIDTH / 2,
      node.position.y + SOURCE_NODE_HEIGHT / 2,
      {
        zoom: DEFAULT_FOCUS_ZOOM,
        duration: 220,
      },
    );
  }

  function openSourceSchema(sourceIndex: number) {
    const source = sources[sourceIndex];
    if (!source) {
      return;
    }

    onNavigateSchemaNode(source.nodeUid, source.variantIndex);
  }

  function applyInitialFit(instance: ReactFlowInstance<SimilarityNodeType, SimilarityEdgeType>) {
    requestAnimationFrame(() => {
      instance.fitView({
        duration: 280,
        padding: 0.16,
        minZoom: 0.12,
        maxZoom: 1.5,
      });
    });
  }

  const selectedNodeLinks = useMemo(() => {
    if (!selectedNode) {
      return [];
    }

    return selectedNodeConnections.map((edge) => {
      const neighborId = edge.source === selectedNode.id ? edge.target : edge.source;
      const neighbor = flowNodes.find((node) => node.id === neighborId);

      return {
        edge,
        neighbor,
      };
    });
  }, [flowNodes, selectedNode, selectedNodeConnections]);

  const sidebarStats = useMemo(() => {
    const totalPairs = graphResponse?.meta.pairs ?? 0;
    const totalNodes = graphResponse?.meta.inputs ?? sources.length;
    const strongEdges = visibleEdges.filter((edge) => edge.score >= threshold).length;

    return [
      {
        label: 'JSON',
        value: totalNodes,
        helper: `${sources.length} источников`,
      },
      {
        label: 'Связей',
        value: totalPairs,
        helper: `${visibleEdges.length} видимых`,
      },
      {
        label: 'Сильных',
        value: strongEdges,
        helper: `порог ${formatPercent(threshold)}`,
      },
      {
        label: 'Средняя сила',
        value: formatPercent(averageScore),
        helper: activeEdge ? `пик ${formatPercent(activeEdge.score)}` : 'нет данных',
      },
    ];
  }, [activeEdge, averageScore, graphResponse?.meta.inputs, graphResponse?.meta.pairs, sources.length, threshold, visibleEdges]);

  return (
    <div className="similarity-shell">
      <aside className="similarity-shell__panel">
        <div className="similarity-shell__hero">
          <div className="schema-viewer__eyebrow">Relations</div>
          <h1 className="schema-viewer__title">Карта связей JSON</h1>
          <p className="schema-viewer__lead">
            Толщина линии показывает крепость совпадения. Это не иерархия, а плотная сеть
            соседей, как в графе Obsidian.
          </p>
        </div>

        <div className="similarity-shell__stats">
          {sidebarStats.map((item) => (
            <div key={item.label} className="similarity-shell__stat">
              <span className="similarity-shell__stat-label">{item.label}</span>
              <strong>{item.value}</strong>
              <span className="similarity-shell__stat-helper">{item.helper}</span>
            </div>
          ))}
        </div>

        <div className="similarity-shell__controls panel">
          <div className="similarity-shell__controls-head">
            <span className="schema-viewer__label">Плотность графа</span>
            <span className="badge">{formatPercent(threshold)}</span>
          </div>

          <input
            className="similarity-shell__range"
            type="range"
            min={MIN_GRAPH_THRESHOLD}
            max={MAX_GRAPH_THRESHOLD}
            step={0.01}
            value={threshold}
            onChange={(event) => {
              setThreshold(clampThreshold(Number(event.target.value)));
            }}
          />

          <div className="similarity-shell__range-meta">
            <span>меньше связей</span>
            <span>больше связей</span>
          </div>

          <div className="similarity-shell__controls-head similarity-shell__controls-head--spaced">
            <span className="schema-viewer__label">Фокус сравнения</span>
            <span className="badge">{Math.round(structureWeight * 100)}% структура</span>
          </div>

          <input
            className="similarity-shell__range"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={structureWeight}
            onChange={(event) => {
              setStructureWeight(Math.max(0, Math.min(1, Number(event.target.value))));
            }}
          />

          <div className="similarity-shell__range-meta">
            <span>jsonschema-diff</span>
            <span>структура схемы</span>
          </div>

          <div className="similarity-shell__controls-actions">
            <button type="button" className="primary" onClick={() => setRefreshToken((value) => value + 1)}>
              Пересчитать
            </button>
            <button type="button" onClick={onGoToGraph}>
              Вернуться к canvas
            </button>
          </div>
        </div>

        <section className="similarity-shell__section">
          <div className="schema-viewer__section-head">
            <span className="schema-viewer__label">Источники</span>
            <span className="schema-viewer__nav-count">{sources.length}</span>
          </div>

          {busy && !graph ? (
            <p className="schema-viewer__nav-state">Загружаю текущий граф...</p>
          ) : loadError && sources.length === 0 ? (
            <p className="schema-viewer__nav-state schema-viewer__nav-state--error">{loadError}</p>
          ) : sources.length === 0 ? (
            <div className="empty-inspector">
              <p>В canvas пока нет JSON-источников.</p>
              <p>Добавь хотя бы две ноды с `rawJsons`, и карта связей появится здесь.</p>
            </div>
          ) : (
            <div className="similarity-shell__source-list">
              {sources.map((source, index) => {
                const responseNodeId = `input-${index + 1}`;
                const isActive = selectedNodeId === responseNodeId;

                return (
                  <article
                    key={`${source.nodeUid}-${source.variantIndex}-${index}`}
                    className={`similarity-shell__source-card${isActive ? ' is-active' : ''}`}
                    style={{ '--source-color': source.nodeColor } as CSSProperties}
                  >
                    <button
                      type="button"
                      className="similarity-shell__source-main"
                      onClick={() => focusFlowNode(responseNodeId)}
                      title={source.summary}
                    >
                      <span className="similarity-shell__source-title">{source.label}</span>
                      <span className="similarity-shell__source-summary">{source.summary}</span>
                    </button>

                    <div className="similarity-shell__source-meta">
                      <span>{formatByteSize(source.rawJson)}</span>
                      <span>{source.nodeMethod}</span>
                      <span>{source.totalVariants} шт.</span>
                    </div>

                    <div className="similarity-shell__source-actions">
                      <button
                        type="button"
                        className="similarity-shell__source-link"
                        onClick={() => openSourceSchema(index)}
                      >
                        Открыть схему
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </aside>

      <main className="similarity-shell__canvas">
        {graphBusy ? <div className="similarity-shell__loading-bar" /> : null}

        {graphResponse ? (
          <ReactFlow<SimilarityNodeType, SimilarityEdgeType>
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onInit={(instance) => {
              reactFlowRef.current = instance;
              applyInitialFit(instance);
            }}
            onNodeClick={(_, node) => {
              setSelectedNodeId(node.id);
              setSelectedEdgeId(null);
            }}
            onEdgeClick={(_, edge) => {
              setSelectedEdgeId(edge.id);
              setSelectedNodeId(null);
            }}
            onPaneClick={() => {
              setSelectedNodeId(null);
              setSelectedEdgeId(null);
            }}
            nodesConnectable={false}
            nodesDraggable={false}
            elementsSelectable
            panOnDrag
            panOnScroll={false}
            zoomOnScroll
            minZoom={0.14}
            className="similarity-shell__flow"
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1.1} />
            <Controls />
          </ReactFlow>
        ) : (
          <div className="similarity-shell__empty">
            <div className="empty-inspector">
              {graphBusy ? (
                <p>Собираю карту связей...</p>
              ) : graphError ? (
                <>
                  <p>{graphError}</p>
                  <p>Проверь, запущен ли Python-сервер и есть ли хотя бы два JSON-источника.</p>
                </>
              ) : (
                <>
                  <p>Карта пока пустая.</p>
                  <p>Добавь несколько JSON-источников в canvas, чтобы увидеть связи между ними.</p>
                </>
              )}
            </div>
          </div>
        )}
      </main>

      <aside className="similarity-shell__panel similarity-shell__panel--details">
        <div className="schema-viewer__eyebrow">Inspector</div>
        <h2 className="schema-viewer__title schema-viewer__title--compact">Крепость связей</h2>

        {!graphResponse ? (
          <div className="empty-inspector">
            <p>Здесь появятся детали выбранной пары после расчета графа.</p>
          </div>
        ) : selectedEdge ? (
          <div className="similarity-shell__inspector">
            <div className="similarity-shell__inspector-card">
              <div className="similarity-shell__pair">
                <button type="button" onClick={() => focusFlowNode(selectedEdge.source)}>
                  {selectedEdge.source}
                </button>
                <span>→</span>
                <button type="button" onClick={() => focusFlowNode(selectedEdge.target)}>
                  {selectedEdge.target}
                </button>
              </div>

              <div className="similarity-shell__score">
                <strong>{selectedEdge.label}</strong>
                <span>сильная связь</span>
              </div>

              <div className="similarity-shell__meter">
                <span style={{ width: `${selectedEdge.percentage}%` }} />
              </div>

              <dl className="similarity-shell__facts">
                <div>
                  <dt>Структура</dt>
                  <dd>{formatPercent(selectedEdge.structure_score)}</dd>
                </div>
                <div>
                  <dt>Diff</dt>
                  <dd>{formatPercent(selectedEdge.diff_score)}</dd>
                </div>
                <div>
                  <dt>Общие токены</dt>
                  <dd>{selectedEdge.metadata.shared_tokens}</dd>
                </div>
                <div>
                  <dt>Вес порога</dt>
                  <dd>{formatPercent(threshold)}</dd>
                </div>
              </dl>
            </div>

            <div className="similarity-shell__inspector-card">
              <div className="schema-viewer__section-head">
                <span className="schema-viewer__label">Статистика сравнения</span>
              </div>

              <div className="similarity-shell__diff-grid">
                {Object.entries(selectedEdge.stats).map(([key, value]) => (
                  <div key={key} className="similarity-shell__diff-item">
                    <span>{key}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : selectedNode ? (
          <div className="similarity-shell__inspector">
            <div className="similarity-shell__inspector-card">
              <div className="similarity-shell__source-header">
                <div>
                  <div className="schema-viewer__eyebrow">Selected</div>
                  <h3 className="similarity-shell__source-heading">{selectedSource?.label ?? selectedNode.data.label}</h3>
                  <p className="schema-viewer__hint">{selectedSource?.summary ?? selectedNode.data.summary}</p>
                </div>
                <span className="badge">{formatPercent(selectedNode.data.strength)}</span>
              </div>

              <div className="similarity-shell__meter">
                <span style={{ width: `${Math.round(selectedNode.data.strength * 100)}%` }} />
              </div>

              <dl className="similarity-shell__facts">
                <div>
                  <dt>Keys</dt>
                  <dd>{selectedNode.data.metadata.total_keys}</dd>
                </div>
                <div>
                  <dt>Tokens</dt>
                  <dd>{selectedNode.data.metadata.structural_tokens}</dd>
                </div>
                <div>
                  <dt>Вариант</dt>
                  <dd>{selectedNode.data.variantLabel}</dd>
                </div>
                <div>
                  <dt>Соседей</dt>
                  <dd>{selectedNode.data.neighborCount}</dd>
                </div>
              </dl>
            </div>

            <div className="similarity-shell__inspector-card">
              <div className="schema-viewer__section-head">
                <span className="schema-viewer__label">Лучшие связи</span>
              </div>

              {selectedNodeLinks.length === 0 ? (
                <p className="similarity-shell__empty-text">Порог скрывает все связи для этой ноды.</p>
              ) : (
                <div className="similarity-shell__link-list">
                  {selectedNodeLinks.map(({ edge, neighbor }) => (
                    <button
                      key={edge.id}
                      type="button"
                      className="similarity-shell__link-row"
                      onClick={() => setSelectedEdgeId(edge.id)}
                    >
                      <span className="similarity-shell__link-row-title">
                        {neighbor?.data.label ?? (edge.source === selectedNode.id ? edge.target : edge.source)}
                      </span>
                      <span className="similarity-shell__link-row-score">{formatPercent(edge.score)}</span>
                      <span className="similarity-shell__link-row-bar">
                        <span style={{ width: `${edge.percentage}%` }} />
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="similarity-shell__inspector">
            <div className="similarity-shell__inspector-card">
              <div className="schema-viewer__section-head">
                <span className="schema-viewer__label">Справка</span>
              </div>
              <p className="schema-viewer__hint">
                Выбери ноду или ребро. Самые толстые линии будут самыми похожими JSON-сценами.
              </p>
              {strongestEdge ? (
                <div className="similarity-shell__score-block">
                  <span className="schema-viewer__label">Самая сильная связь</span>
                  <strong>{strongestEdge.label}</strong>
                  <p className="schema-viewer__hint">
                    Между `{strongestEdge.source}` и `{strongestEdge.target}`.
                  </p>
                </div>
              ) : null}
            </div>

            <div className="similarity-shell__inspector-card">
              <div className="schema-viewer__section-head">
                <span className="schema-viewer__label">Легенда</span>
              </div>
              <ul className="similarity-shell__legend">
                <li>Толще линия означает более высокое совпадение схем.</li>
                <li>Порог скрывает слабые ребра и очищает шум.</li>
                <li>Клик по ноде показывает ее лучшие соседства.</li>
              </ul>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function SimilarityNode({ data, selected }: NodeProps<SimilarityNodeType>) {
  const tone =
    data.strength >= 0.75 ? 'high' : data.strength >= 0.5 ? 'mid' : data.strength > 0 ? 'low' : 'none';

  return (
    <article
      className={`similarity-node similarity-node--${tone}${selected ? ' is-selected' : ''}`}
      title={data.summary}
    >
      <Handle type="target" position={Position.Left} className="similarity-node__handle" />

      <div className="similarity-node__head">
        <div className="similarity-node__titles">
          <div className="similarity-node__title">{data.label}</div>
          <div className="similarity-node__subtitle">{data.variantLabel}</div>
        </div>
        <span className="similarity-node__badge">{formatPercent(data.strength)}</span>
      </div>

      <p className="similarity-node__summary">{data.summary}</p>

      <div className="similarity-node__facts">
        <span>{data.metadata.total_keys} keys</span>
        <span>{data.metadata.structural_tokens} tokens</span>
        <span>{data.neighborCount} links</span>
      </div>

      <div className="similarity-node__meter">
        <span style={{ width: `${Math.round(data.strength * 100)}%` }} />
      </div>

      <Handle type="source" position={Position.Right} className="similarity-node__handle" />
    </article>
  );
}

function SimilarityEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
}: EdgeProps<SimilarityEdgeType>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.28,
  });

  const score = Math.max(0, Math.min(1, data?.score ?? 0));
  const opacity = Math.max(0.14, Math.min(0.9, 0.12 + score * 0.88));
  const strokeWidth = 1.1 + score * 4.4;
  const percentage = typeof data?.percentage === 'number' ? data.percentage : score * 100;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={24}
        className={`similarity-edge__path${selected ? ' is-selected' : ''}`}
        style={{
          strokeWidth,
          opacity,
        }}
      />

      {selected ? (
        <EdgeLabelRenderer>
          <div
            className={`similarity-edge__label${selected ? ' is-selected' : ''}`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {Math.round(percentage * 10) / 10}%
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
