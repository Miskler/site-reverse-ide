import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from '@xyflow/react';
import {
  STORAGE_KEY,
  createDefaultGraph,
  createEdgeDraft,
  createId,
  createNodeDraft,
  pickNodeColor,
  sanitizeGraphDocument,
  type GraphDocument,
  type GraphEdge,
  type GraphNode,
} from './shared/graph';
import { CanvasEdge } from './components/CanvasEdge';
import { CanvasNode, type CanvasNodeData, type CanvasNodeType } from './components/CanvasNode';

type StatusTone = 'neutral' | 'success' | 'warning';

type FlowEdge = Edge;

const nodeTypes = {
  canvasNode: CanvasNode,
};

const edgeTypes = {
  canvasEdge: CanvasEdge,
};

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
  const [connectMode, setConnectMode] = useState(false);
  const [statusText, setStatusText] = useState('Загрузка графа...');
  const [statusTone, setStatusTone] = useState<StatusTone>('neutral');
  const [hydrated, setHydrated] = useState(false);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<CanvasNodeType, FlowEdge> | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const statusTimerRef = useRef<number | null>(null);
  const fittedRef = useRef(false);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const deleteNodeRef = useRef<(nodeId: string) => void>(() => undefined);
  const deleteNodeProxyRef = useRef<(nodeId: string) => void>((nodeId: string) => {
    deleteNodeRef.current(nodeId);
  });
  const deleteNodeProxy = deleteNodeProxyRef.current;

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  useEffect(() => {
    deleteNodeRef.current = handleDeleteNode;
  });

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
        title: node.data.title,
        note: node.data.note,
        color: node.data.color,
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

    return document.nodes.map((node, index) => ({
      id: node.id,
      type: 'canvasNode',
      position: node.position,
      data: {
        title: node.title,
        note: node.note,
        color: node.color,
        connectMode,
        linkCount: linkCounts.get(node.id) ?? 0,
        onDelete: deleteNodeProxy,
      },
      draggable: true,
      selectable: true,
    }));
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

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(async () => {
      try {
        const saved = sanitizeGraphDocument(await api.saveGraph(document));
        applyDocument(saved, { preserveSelection: true });
        setStatus(message, tone);
      } catch (error) {
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
    const newNode: CanvasNodeType = {
      id: createId('node'),
      type: 'canvasNode',
      position: position ?? getCanvasCenter(),
      data: {
        title: `Блок ${index + 1}`,
        note: 'Коротко опиши смысл этого блока.',
        color: pickNodeColor(index),
        connectMode,
        linkCount: 0,
        onDelete: deleteNodeProxy,
      },
      draggable: true,
      selectable: true,
    };

    const nextNodes = [...nodesRef.current, newNode];
    const nextEdges = edgesRef.current;

    setNodes(nextNodes);
    setSelectedNodeId(newNode.id);
    setSelectedEdgeId(null);
    scheduleSave(nextNodes, nextEdges, 'Блок добавлен');
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

    scheduleSave(nextNodes, edgesRef.current, 'Блок перемещён');
    setSelectedNodeId(node.id);
  }

  function handleConnect(connection: Connection) {
    if (!connection.source || !connection.target) {
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
      setStatus('Такая связь уже есть', 'warning');
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

    scheduleSave(nextNodes, nextEdges, 'Блок удалён');
  }

  function handleDeleteEdge(edgeId: string) {
    const nextEdges = edgesRef.current.filter((edge) => edge.id !== edgeId);

    setEdges(nextEdges);

    if (selectedEdgeId === edgeId) {
      setSelectedEdgeId(null);
    }

    scheduleSave(nodesRef.current, nextEdges, 'Связь удалена');
  }

  function deleteSelection() {
    if (selectedNodeId) {
      handleDeleteNode(selectedNodeId);
      return;
    }

    if (selectedEdgeId) {
      handleDeleteEdge(selectedEdgeId);
      return;
    }

    setStatus('Нечего удалять', 'warning');
  }

  function resetDemo() {
    const nextGraph = createDefaultGraph();
    applyDocument(nextGraph, { selectFirst: true });
    setConnectMode(false);
    fittedRef.current = false;
    requestAnimationFrame(() => {
      reactFlowInstance?.fitView({
        padding: 0.18,
        duration: 300,
      });
      fittedRef.current = true;
    });
    scheduleSave(buildFlowNodes(nextGraph), buildFlowEdges(nextGraph), 'Demo восстановлен');
    setStatus('Demo восстановлен');
  }

  function selectNode(nodeId: string) {
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
  }

  function selectEdge(edgeId: string) {
    setSelectedEdgeId(edgeId);
    setSelectedNodeId(null);
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

  function updateSelectedNode(patch: Partial<Pick<GraphNode, 'title' | 'note' | 'color'>>) {
    if (!selectedNodeId) {
      return;
    }

    const nextNodes = nodesRef.current.map((node) => {
      if (node.id !== selectedNodeId) {
        return node;
      }

      return {
        ...node,
        data: {
          ...node.data,
          title: patch.title !== undefined ? patch.title.trim() || 'Без названия' : node.data.title,
          note: patch.note !== undefined ? patch.note : node.data.note,
          color: patch.color !== undefined ? patch.color : node.data.color,
        },
      };
    });

    setNodes(nextNodes);
    scheduleSave(nextNodes, edgesRef.current, 'Параметры блока обновлены');
  }

  function updateSelectedNodeTitle(value: string) {
    updateSelectedNode({ title: value });
  }

  function updateSelectedNodeNote(value: string) {
    updateSelectedNode({ note: value });
  }

  function updateSelectedNodeColor(value: string) {
    updateSelectedNode({ color: value });
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
          onDelete: deleteNodeProxy,
        },
      })),
    [connectMode, deleteNodeProxy, linkCounts, nodes],
  );

  const flowEdges: FlowEdge[] = useMemo(() => edges.map((edge) => ({ ...edge })), [edges]);

  const selectedNode = useMemo(
    () => (selectedNodeId ? nodes.find((node) => node.id === selectedNodeId) ?? null : null),
    [nodes, selectedNodeId],
  );
  const selectedEdge = useMemo(
    () => (selectedEdgeId ? edges.find((edge) => edge.id === selectedEdgeId) ?? null : null),
    [edges, selectedEdgeId],
  );

  const connectedNodes = useMemo(
    () => nodes.filter((node) => (linkCounts.get(node.id) ?? 0) > 0).length,
    [linkCounts, nodes],
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-card">
          <p className="eyebrow">Fastify + React Flow</p>
          <h1>Canvas Links</h1>
          <p className="lede">
            Собирай карту идей, тяни блоки мышью и связывай их без Python и без тяжёлого бэкенда.
          </p>
        </div>

        <section className="stats-grid" aria-label="Статистика графа">
          <article className="stat-card">
            <span className="stat-card__label">Блоки</span>
            <strong>{nodes.length}</strong>
          </article>
          <article className="stat-card">
            <span className="stat-card__label">Связи</span>
            <strong>{edges.length}</strong>
          </article>
          <article className="stat-card">
            <span className="stat-card__label">Активные</span>
            <strong>{connectedNodes}</strong>
          </article>
          <article className={`stat-card tone-${statusTone}`}>
            <span className="stat-card__label">Статус</span>
            <strong>{statusTone === 'warning' ? 'Внимание' : statusTone === 'success' ? 'ОК' : 'Ждёт'}</strong>
          </article>
        </section>

        <div className="toolbar">
          <button className="primary" type="button" onClick={handleAddNodeClick}>
            Добавить блок
          </button>
          <button
            type="button"
            className={connectMode ? 'is-active' : ''}
            aria-pressed={connectMode}
            onClick={() => {
              const nextConnectMode = !connectMode;
              setConnectMode(nextConnectMode);
              setStatus(nextConnectMode ? 'Режим связи включён' : 'Режим связи выключен');
            }}
          >
            {connectMode ? 'Режим связи: вкл' : 'Режим связи: выкл'}
          </button>
          <button type="button" className="danger" onClick={deleteSelection}>
            Удалить выбранное
          </button>
          <button type="button" onClick={resetDemo}>
            Сбросить demo
          </button>
        </div>

        <section className="panel inspector">
          <div className="panel-head">
            <h2>Инспектор</h2>
            <span className="badge">{statusText}</span>
          </div>

          {selectedNode ? (
            <div className="editor">
              <label>
                <span>Название</span>
                <input
                  type="text"
                  value={selectedNode.data.title}
                  placeholder="Название блока"
                  onChange={(event) => updateSelectedNodeTitle(event.target.value)}
                />
              </label>
              <label>
                <span>Описание</span>
                <textarea
                  rows={5}
                  value={selectedNode.data.note}
                  placeholder="Коротко опиши смысл блока"
                  onChange={(event) => updateSelectedNodeNote(event.target.value)}
                />
              </label>
              <label>
                <span>Цвет</span>
                <input
                  type="color"
                  value={selectedNode.data.color}
                  onChange={(event) => updateSelectedNodeColor(event.target.value)}
                />
              </label>
              <div className="inspector-meta">
                <div>
                  <span className="inspector-meta__label">ID</span>
                  <strong>{selectedNode.id}</strong>
                </div>
                <div>
                  <span className="inspector-meta__label">Позиция</span>
                  <strong>
                    {Math.round(selectedNode.position.x)}, {Math.round(selectedNode.position.y)}
                  </strong>
                </div>
                <div>
                  <span className="inspector-meta__label">Связей</span>
                  <strong>{selectedNode.data.linkCount}</strong>
                </div>
              </div>
            </div>
          ) : selectedEdge ? (
            <div className="editor edge-editor">
              <p className="edge-summary">{formatEdgeLabel(nodes, selectedEdge)}</p>
              <p className="helper">
                Выдели связь на холсте и удали её, если она больше не нужна.
              </p>
              <button type="button" className="danger" onClick={() => handleDeleteEdge(selectedEdge.id)}>
                Удалить связь
              </button>
            </div>
          ) : (
            <div className="empty-inspector">
              <p>Ничего не выбрано.</p>
              <ul>
                <li>Кликни по блоку, чтобы открыть свойства.</li>
                <li>Включи режим связи и соедини два блока.</li>
                <li>Двойной клик по холсту создаёт новый блок в точке курсора.</li>
              </ul>
            </div>
          )}
        </section>

        <section className="panel compact tips-panel">
          <h2>Подсказки</h2>
          <ul className="tips">
            <li>Перетаскивай блоки, чтобы перестраивать карту.</li>
            <li>Связи сохраняются в JSON-файл на сервере и в localStorage.</li>
            <li>Нажми <kbd>Escape</kbd>, чтобы снять выделение и выключить режим связи.</li>
          </ul>
        </section>
      </aside>

      <main className="workspace-shell">
        <div className="canvas-frame" ref={canvasRef} onDoubleClick={handlePaneDoubleClick}>
          <div className="canvas-frame__topbar">
            <div>
              <p className="canvas-label">Рабочее поле</p>
              <h2>Связи и блоки</h2>
            </div>
            <div className="canvas-pill">{connectMode ? 'Соединение активно' : 'Обычный режим'}</div>
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
            onNodeClick={(_: ReactMouseEvent, node) => selectNode(node.id)}
            onNodeDragStop={handleNodeDragStop}
            onEdgeClick={(_: ReactMouseEvent, edge) => selectEdge(edge.id)}
            onPaneClick={() => {
              setSelectedNodeId(null);
              setSelectedEdgeId(null);
            }}
            onConnect={handleConnect}
            nodesConnectable={connectMode}
            nodesDraggable
            deleteKeyCode={null}
            panOnDrag
            panOnScroll
            zoomOnScroll
            defaultEdgeOptions={{
              type: 'canvasEdge',
            }}
            className="canvas-flow"
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} />
            <Controls />
          </ReactFlow>
        </div>
      </main>
    </div>
  );
}

function formatEdgeLabel(nodes: CanvasNodeType[], edge: FlowEdge) {
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);

  if (!source || !target) {
    return 'Связь: один из блоков уже удалён';
  }

  return `Связь: ${source.data.title} → ${target.data.title}`;
}
