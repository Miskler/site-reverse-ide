(() => {
  const workspace = document.getElementById("workspace");
  const scene = document.getElementById("scene");
  const edgeLayer = document.getElementById("edge-layer");
  const nodeLayer = document.getElementById("node-layer");
  const emptyState = document.getElementById("empty-state");
  const statusText = document.getElementById("status-text");
  const selectionBadge = document.getElementById("selection-badge");
  const nodeEditor = document.getElementById("node-editor");
  const edgeEditor = document.getElementById("edge-editor");
  const edgeSummary = document.getElementById("edge-summary");
  const titleInput = document.getElementById("node-title-input");
  const noteInput = document.getElementById("node-note-input");
  const colorInput = document.getElementById("node-color-input");
  const addNodeBtn = document.getElementById("add-node-btn");
  const connectModeBtn = document.getElementById("connect-mode-btn");
  const deleteBtn = document.getElementById("delete-btn");
  const resetBtn = document.getElementById("reset-btn");

  const STORAGE_KEY = "canvas-links-graph-v1";
  const DEFAULT_COLORS = ["#2f8f83", "#ef7d57", "#d9a441", "#5f7cff", "#b85fe4", "#5b8c57"];

  const state = {
    graph: null,
    selectedNodeId: null,
    selectedEdgeId: null,
    connectMode: false,
    connectSourceId: null,
    previewPoint: null,
    dragging: null,
    panning: null,
    saveTimer: null,
    lastStatusTimer: null,
  };

  const api = {
    async loadGraph() {
      const response = await fetch("/api/graph", { headers: { Accept: "application/json" } });
      if (!response.ok) {
        throw new Error(`Failed to load graph (${response.status})`);
      }
      return response.json();
    },
    async saveGraph(graph) {
      const response = await fetch("/api/graph", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(graph),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `Failed to save graph (${response.status})`);
      }
      return response.json();
    },
  };

  init().catch((error) => {
    console.error(error);
    setStatus("Не удалось загрузить граф. Проверь сервер.", true);
  });

  async function init() {
    const saved = await loadInitialGraph();
    state.graph = normalizeGraph(saved);
    if (!state.graph.nodes.length) {
      state.graph = normalizeGraph(createDemoGraph());
    }

    bindEvents();
    render();
    updateEditor();
    setStatus("Граф загружен");
  }

  async function loadInitialGraph() {
    try {
      const graph = await api.loadGraph();
      return graph;
    } catch (error) {
      console.warn("Server graph load failed, using localStorage fallback", error);
      const cached = window.localStorage.getItem(STORAGE_KEY);
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch (parseError) {
          console.warn("Invalid cached graph", parseError);
        }
      }
      return createDemoGraph();
    }
  }

  function bindEvents() {
    addNodeBtn.addEventListener("click", () => {
      const point = getViewportCenter();
      const node = createNode({
        x: point.x,
        y: point.y,
        title: nextNodeTitle(),
        note: "Коротко опиши смысл этого блока.",
        color: pickColor(),
      });
      state.graph.nodes.push(node);
      selectNode(node.id);
      updateEditor();
      queueSave("Блок добавлен");
      render();
    });

    connectModeBtn.addEventListener("click", () => {
      state.connectMode = !state.connectMode;
      state.connectSourceId = null;
      state.previewPoint = null;
      setStatus(state.connectMode ? "Режим связи включен" : "Режим связи выключен");
      render();
    });

    deleteBtn.addEventListener("click", () => {
      deleteSelection();
    });

    resetBtn.addEventListener("click", () => {
      state.graph = normalizeGraph(createDemoGraph());
      state.selectedNodeId = state.graph.nodes[0]?.id ?? null;
      state.selectedEdgeId = null;
      state.connectSourceId = null;
      state.previewPoint = null;
      state.connectMode = false;
      render();
      updateEditor();
      queueSave("Демо восстановлено");
    });

    titleInput.addEventListener("input", () => {
      const node = getSelectedNode();
      if (!node) {
        return;
      }
      node.title = titleInput.value.trim() || "Без названия";
      render();
      queueSave("Название обновлено");
    });

    noteInput.addEventListener("input", () => {
      const node = getSelectedNode();
      if (!node) {
        return;
      }
      node.note = noteInput.value;
      render();
      queueSave("Описание обновлено");
    });

    colorInput.addEventListener("input", () => {
      const node = getSelectedNode();
      if (!node) {
        return;
      }
      node.color = colorInput.value;
      render();
      queueSave("Цвет обновлен");
    });

    workspace.addEventListener("dblclick", (event) => {
      const scenePoint = toScenePoint(event);
      if (!scenePoint) {
        return;
      }
      if (event.target.closest(".node") || event.target.closest(".edge-path")) {
        return;
      }
      const node = createNode({
        x: scenePoint.x - 130,
        y: scenePoint.y - 60,
        title: nextNodeTitle(),
        note: "Новый блок готов к связи.",
        color: pickColor(),
      });
      state.graph.nodes.push(node);
      selectNode(node.id);
      updateEditor();
      queueSave("Блок добавлен");
      render();
    });

    workspace.addEventListener("pointerdown", handleWorkspacePointerDown);

    workspace.addEventListener("pointermove", handleWorkspacePointerMove);
    workspace.addEventListener("pointerleave", handleWorkspacePointerLeave);

    nodeLayer.addEventListener("click", (event) => {
      const nodeEl = event.target.closest(".node");
      if (!nodeEl || event.target.closest("button")) {
        return;
      }

      const nodeId = nodeEl.dataset.id;
      if (state.connectMode) {
        handleConnectionClick(nodeId);
        return;
      }

      selectNode(nodeId);
      updateEditor();
      render();
    });

    nodeLayer.addEventListener("click", (event) => {
      const deleteButton = event.target.closest(".node-delete");
      if (!deleteButton) {
        return;
      }
      const nodeEl = event.target.closest(".node");
      if (!nodeEl) {
        return;
      }
      removeNode(nodeEl.dataset.id);
    });

    edgeLayer.addEventListener("click", (event) => {
      const edge = event.target.closest(".edge-path");
      if (!edge) {
        return;
      }
      selectEdge(edge.dataset.id);
      updateEditor();
      render();
      event.stopPropagation();
    });

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerCancel);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", render);
  }

  function handleWorkspacePointerDown(event) {
    if (event.button !== 0) {
      return;
    }

    const nodeEl = event.target.closest(".node");
    if (nodeEl && !event.target.closest("button")) {
      if (state.connectMode) {
        return;
      }

      const node = getNodeById(nodeEl.dataset.id);
      if (!node) {
        return;
      }

      const scenePoint = toScenePoint(event);
      if (!scenePoint) {
        return;
      }

      state.dragging = {
        id: node.id,
        pointerId: event.pointerId,
        startX: scenePoint.x,
        startY: scenePoint.y,
        offsetX: scenePoint.x - node.x,
        offsetY: scenePoint.y - node.y,
        moved: false,
      };
      nodeEl.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }

    if (event.target.closest(".edge-path") || event.target.closest("button")) {
      return;
    }

    state.panning = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startScrollLeft: workspace.scrollLeft,
      startScrollTop: workspace.scrollTop,
      moved: false,
    };
    state.previewPoint = null;
    workspace.setPointerCapture(event.pointerId);
    event.preventDefault();
    renderEdges();
    updateControls();
  }

  function handlePointerMove(event) {
    if (state.panning && state.panning.pointerId === event.pointerId) {
      const deltaX = event.clientX - state.panning.startClientX;
      const deltaY = event.clientY - state.panning.startClientY;
      if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
        state.panning.moved = true;
      }

      workspace.scrollLeft = Math.max(0, state.panning.startScrollLeft - deltaX);
      workspace.scrollTop = Math.max(0, state.panning.startScrollTop - deltaY);
      return;
    }

    if (!state.dragging || state.dragging.pointerId !== event.pointerId) {
      return;
    }
    const node = getNodeById(state.dragging.id);
    if (!node) {
      return;
    }

    const scenePoint = toScenePoint(event);
    if (!scenePoint) {
      return;
    }

    const nextX = Math.max(0, scenePoint.x - state.dragging.offsetX);
    const nextY = Math.max(0, scenePoint.y - state.dragging.offsetY);
    if (Math.abs(scenePoint.x - state.dragging.startX) > 4 || Math.abs(scenePoint.y - state.dragging.startY) > 4) {
      state.dragging.moved = true;
    }

    node.x = nextX;
    node.y = nextY;
    ensureSceneSize();
    syncDraggedNodeDom(node);
    renderEdges();
    updateControls();
  }

  function handlePointerUp(event) {
    if (state.panning && state.panning.pointerId === event.pointerId) {
      state.panning = null;
      updateControls();
      return;
    }

    if (!state.dragging || state.dragging.pointerId !== event.pointerId) {
      return;
    }

    const draggedNodeId = state.dragging.id;
    const moved = state.dragging.moved;
    state.dragging = null;
    selectNode(draggedNodeId);
    updateEditor();
    render();
    if (moved) {
      queueSave("Блок перемещен");
    }
  }

  function handlePointerCancel(event) {
    if (state.dragging && state.dragging.pointerId === event.pointerId) {
      state.dragging = null;
      render();
      return;
    }

    if (state.panning && state.panning.pointerId === event.pointerId) {
      state.panning = null;
      updateControls();
    }
  }

  function handleWorkspacePointerMove(event) {
    if (!state.connectMode || !state.connectSourceId || state.dragging || state.panning) {
      return;
    }
    state.previewPoint = toScenePoint(event);
    renderEdges();
  }

  function handleWorkspacePointerLeave() {
    if (!state.connectMode || !state.connectSourceId) {
      return;
    }
    state.previewPoint = null;
    renderEdges();
  }

  function handleKeyDown(event) {
    if (isTypingInField()) {
      return;
    }

    if (event.key === "Escape") {
      state.panning = null;
      state.connectMode = false;
      state.connectSourceId = null;
      state.previewPoint = null;
      setStatus("Режим связи выключен");
      render();
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      deleteSelection();
    }
  }

  function handleConnectionClick(nodeId) {
    if (!state.connectSourceId) {
      state.connectSourceId = nodeId;
      state.selectedNodeId = nodeId;
      state.selectedEdgeId = null;
      state.previewPoint = null;
      setStatus("Выбери второй блок для создания связи");
      updateEditor();
      render();
      return;
    }

    if (state.connectSourceId === nodeId) {
      state.connectSourceId = null;
      state.previewPoint = null;
      setStatus("Источник связи сброшен");
      render();
      return;
    }

    const edge = createEdge(state.connectSourceId, nodeId);
    if (!edge) {
      setStatus("Такая связь уже есть", true);
      return;
    }

    state.graph.edges.push(edge);
    state.connectSourceId = null;
    state.previewPoint = null;
    state.selectedEdgeId = edge.id;
    state.selectedNodeId = null;
    updateEditor();
    render();
    queueSave("Связь добавлена");
  }

  function deleteSelection() {
    if (state.selectedNodeId) {
      removeNode(state.selectedNodeId);
      return;
    }

    if (state.selectedEdgeId) {
      removeEdge(state.selectedEdgeId);
      return;
    }

    setStatus("Нечего удалять", true);
  }

  function removeNode(nodeId) {
    const index = state.graph.nodes.findIndex((node) => node.id === nodeId);
    if (index === -1) {
      return;
    }

    state.graph.nodes.splice(index, 1);
    state.graph.edges = state.graph.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);

    if (state.selectedNodeId === nodeId) {
      state.selectedNodeId = null;
    }
    if (state.selectedEdgeId && !state.graph.edges.some((edge) => edge.id === state.selectedEdgeId)) {
      state.selectedEdgeId = null;
    }
    if (state.connectSourceId === nodeId) {
      state.connectSourceId = null;
    }
    state.previewPoint = null;

    updateEditor();
    render();
    queueSave("Блок удален");
  }

  function removeEdge(edgeId) {
    const index = state.graph.edges.findIndex((edge) => edge.id === edgeId);
    if (index === -1) {
      return;
    }

    state.graph.edges.splice(index, 1);
    if (state.selectedEdgeId === edgeId) {
      state.selectedEdgeId = null;
    }
    state.previewPoint = null;
    updateEditor();
    render();
    queueSave("Связь удалена");
  }

  function selectNode(nodeId) {
    state.selectedNodeId = nodeId;
    state.selectedEdgeId = null;
    state.previewPoint = null;
  }

  function selectEdge(edgeId) {
    state.selectedEdgeId = edgeId;
    state.selectedNodeId = null;
    state.connectSourceId = null;
    state.previewPoint = null;
  }

  function updateEditor() {
    const node = getSelectedNode();
    const edge = getSelectedEdge();
    const hasNode = Boolean(node);
    const hasEdge = Boolean(edge);

    nodeEditor.classList.toggle("hidden", !hasNode);
    edgeEditor.classList.toggle("hidden", !hasEdge);

    if (hasNode) {
      titleInput.value = node.title;
      noteInput.value = node.note;
      colorInput.value = node.color;
      selectionBadge.textContent = "Выбран блок";
      edgeSummary.textContent = "Связь не выбрана";
      return;
    }

    if (hasEdge) {
      const source = getNodeById(edge.source);
      const target = getNodeById(edge.target);
      edgeSummary.textContent = source && target
        ? `Связь: ${source.title} → ${target.title}`
        : "Связь: один из блоков уже удален";
      selectionBadge.textContent = "Выбрана связь";
      return;
    }

    selectionBadge.textContent = "Ничего не выбрано";
    titleInput.value = "";
    noteInput.value = "";
    colorInput.value = "#2f8f83";
  }

  function render() {
    state.graph = normalizeGraph(state.graph);
    renderNodes();
    ensureSceneSize();
    renderEdges();
    updateControls();
    updateEmptyState();
  }

  function renderNodes() {
    const fragment = document.createDocumentFragment();
    const selectedNodeId = state.selectedNodeId;
    const sourceNodeId = state.connectSourceId;

    for (const node of state.graph.nodes) {
      const nodeEl = document.createElement("article");
      nodeEl.className = "node";
      nodeEl.dataset.id = node.id;
      nodeEl.style.left = `${node.x}px`;
      nodeEl.style.top = `${node.y}px`;
      nodeEl.style.setProperty("--node-accent", node.color);
      nodeEl.classList.toggle("is-selected", node.id === selectedNodeId);
      nodeEl.classList.toggle("is-source", node.id === sourceNodeId);
      nodeEl.innerHTML = `
        <div class="node-header">
          <span class="node-tag">Блок</span>
          <button class="node-delete" type="button" aria-label="Удалить блок">×</button>
        </div>
        <h3>${escapeHtml(node.title)}</h3>
        <p>${escapeHtml(node.note || "Здесь появится описание блока.")}</p>
        <div class="node-meta">
          <span>Перетащи меня</span>
          <span>${countNodeLinks(node.id)} связ.</span>
        </div>
      `;
      fragment.appendChild(nodeEl);
    }

    nodeLayer.innerHTML = "";
    nodeLayer.appendChild(fragment);
  }

  function renderEdges() {
    edgeLayer.innerHTML = "";
    edgeLayer.setAttribute("viewBox", `0 0 ${scene.clientWidth} ${scene.clientHeight}`);
    edgeLayer.setAttribute("preserveAspectRatio", "none");

    for (const edge of state.graph.edges) {
      const source = getNodeById(edge.source);
      const target = getNodeById(edge.target);
      if (!source || !target) {
        continue;
      }

      const { startX, startY, endX, endY, controlX1, controlY1, controlX2, controlY2 } = getEdgeGeometry(source, target);
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M ${startX} ${startY} C ${controlX1} ${controlY1}, ${controlX2} ${controlY2}, ${endX} ${endY}`);
      path.classList.add("edge-path");
      if (edge.id === state.selectedEdgeId) {
        path.classList.add("is-selected");
      }
      path.dataset.id = edge.id;
      path.style.pointerEvents = "stroke";
      edgeLayer.appendChild(path);
    }

    if (state.connectMode && state.connectSourceId) {
      const source = getNodeById(state.connectSourceId);
      if (source) {
        const preview = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const sourcePoint = getNodeAnchor(source, "right");
        const targetPoint = state.previewPoint || sourcePoint;
        const bend = Math.max(70, Math.min(180, Math.abs(targetPoint.x - sourcePoint.x) * 0.4));
        preview.setAttribute(
          "d",
          `M ${sourcePoint.x} ${sourcePoint.y} C ${sourcePoint.x + bend} ${sourcePoint.y}, ${targetPoint.x - bend} ${targetPoint.y}, ${targetPoint.x} ${targetPoint.y}`,
        );
        preview.classList.add("edge-path", "preview");
        preview.style.pointerEvents = "none";
        edgeLayer.appendChild(preview);
      }
    }
  }

  function updateControls() {
    connectModeBtn.textContent = state.connectMode ? "Режим связи: вкл" : "Режим связи: выкл";
    workspace.classList.toggle("is-connecting", state.connectMode);
    workspace.classList.toggle("is-panning", Boolean(state.panning));
    workspace.style.cursor = state.panning ? "grabbing" : state.connectMode ? "crosshair" : "grab";
    deleteBtn.disabled = !state.selectedNodeId && !state.selectedEdgeId;
    deleteBtn.style.opacity = deleteBtn.disabled ? "0.55" : "1";
  }

  function updateEmptyState() {
    emptyState.classList.toggle("hidden", state.graph.nodes.length > 0);
  }

  function queueSave(message) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.graph));
    if (state.saveTimer) {
      window.clearTimeout(state.saveTimer);
    }

    state.saveTimer = window.setTimeout(async () => {
      try {
        await api.saveGraph(state.graph);
        setStatus(message || "Изменения сохранены");
      } catch (error) {
        console.warn("Save failed", error);
        setStatus("Сохранил в браузере, но сервер недоступен", true);
      }
    }, 220);
  }

  function setStatus(message, isWarning = false) {
    statusText.textContent = message;
    statusText.style.color = isWarning ? "#f3c0b9" : "";
    if (state.lastStatusTimer) {
      window.clearTimeout(state.lastStatusTimer);
    }
    state.lastStatusTimer = window.setTimeout(() => {
      statusText.textContent = "Готов к работе";
      statusText.style.color = "";
    }, 2600);
  }

  function ensureSceneSize() {
    const baseWidth = Math.max(workspace.clientWidth + 420, 1400);
    const baseHeight = Math.max(workspace.clientHeight + 420, 900);

    let maxX = baseWidth;
    let maxY = baseHeight;

    for (const node of state.graph.nodes) {
      const { width, height } = getNodeMetrics(node);
      maxX = Math.max(maxX, node.x + width + 160);
      maxY = Math.max(maxY, node.y + height + 160);
    }

    scene.style.width = `${Math.ceil(maxX)}px`;
    scene.style.height = `${Math.ceil(maxY)}px`;
  }

  function createDemoGraph() {
    return {
      version: 1,
      nodes: [
        createNode({ id: "node-start", x: 120, y: 120, title: "Идея", note: "Исходная мысль или рабочая задача.", color: "#2f8f83" }),
        createNode({ id: "node-middle", x: 420, y: 260, title: "Разбор", note: "Промежуточный шаг, зависимость или черновик.", color: "#ef7d57" }),
        createNode({ id: "node-end", x: 780, y: 160, title: "Результат", note: "Финальный вывод, который должен получиться.", color: "#d9a441" }),
      ],
      edges: [
        { id: "edge-start-middle", source: "node-start", target: "node-middle" },
        { id: "edge-middle-end", source: "node-middle", target: "node-end" },
      ],
    };
  }

  function createNode(input) {
    return {
      id: input.id || createId("node"),
      title: input.title || "Без названия",
      note: input.note || "",
      x: Number.isFinite(input.x) ? input.x : 120,
      y: Number.isFinite(input.y) ? input.y : 120,
      color: input.color || pickColor(),
    };
  }

  function createEdge(source, target) {
    if (source === target) {
      return null;
    }
    if (state.graph.edges.some((edge) => edge.source === source && edge.target === target)) {
      return null;
    }
    return {
      id: createId("edge"),
      source,
      target,
    };
  }

  function normalizeGraph(graph) {
    const safeGraph = graph && typeof graph === "object" ? graph : {};
    const nodes = Array.isArray(safeGraph.nodes) ? safeGraph.nodes.map((node) => createNode(node)) : [];
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = Array.isArray(safeGraph.edges)
      ? safeGraph.edges
        .map((edge) => ({
          id: edge?.id || createId("edge"),
          source: String(edge?.source || ""),
          target: String(edge?.target || ""),
        }))
        .filter((edge) => edge.source && edge.target && edge.source !== edge.target && nodeIds.has(edge.source) && nodeIds.has(edge.target))
      : [];

    const seen = new Set();
    const dedupedEdges = [];
    for (const edge of edges) {
      const key = `${edge.source}::${edge.target}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      dedupedEdges.push(edge);
    }

    return {
      version: 1,
      nodes,
      edges: dedupedEdges,
    };
  }

  function getNodeById(nodeId) {
    return state.graph.nodes.find((node) => node.id === nodeId) || null;
  }

  function getSelectedNode() {
    return state.selectedNodeId ? getNodeById(state.selectedNodeId) : null;
  }

  function getSelectedEdge() {
    return state.selectedEdgeId ? state.graph.edges.find((edge) => edge.id === state.selectedEdgeId) || null : null;
  }

  function countNodeLinks(nodeId) {
    let total = 0;
    for (const edge of state.graph.edges) {
      if (edge.source === nodeId || edge.target === nodeId) {
        total += 1;
      }
    }
    return total;
  }

  function getEdgeGeometry(source, target) {
    const sourcePoint = getNodeAnchor(source, "right");
    const targetPoint = getNodeAnchor(target, "left");
    const dx = targetPoint.x - sourcePoint.x;
    const dy = targetPoint.y - sourcePoint.y;
    const bend = Math.max(84, Math.min(220, Math.abs(dx) * 0.45));
    const slope = Math.max(30, Math.min(110, Math.abs(dy) * 0.2));
    return {
      startX: sourcePoint.x,
      startY: sourcePoint.y,
      endX: targetPoint.x,
      endY: targetPoint.y,
      controlX1: sourcePoint.x + bend,
      controlY1: sourcePoint.y + (dy < 0 ? -slope : slope),
      controlX2: targetPoint.x - bend,
      controlY2: targetPoint.y + (dy < 0 ? slope : -slope),
    };
  }

  function getNodeAnchor(node, side) {
    const { width, height } = getNodeMetrics(node);
    const x = side === "left" ? node.x : node.x + width;
    const y = node.y + height / 2;
    return { x, y };
  }

  function getNodeMetrics(node) {
    const element = getNodeElement(node.id);
    if (element) {
      return {
        width: element.offsetWidth || 280,
        height: element.offsetHeight || 160,
      };
    }

    return {
      width: getNodeWidth(node),
      height: getNodeHeight(node),
    };
  }

  function getNodeElement(nodeId) {
    const safeId =
      window.CSS && typeof window.CSS.escape === "function"
        ? window.CSS.escape(nodeId)
        : String(nodeId).replaceAll('"', '\\"');
    return nodeLayer.querySelector(`.node[data-id="${safeId}"]`);
  }

  function syncDraggedNodeDom(node) {
    const element = getNodeElement(node.id);
    if (!element) {
      return;
    }

    element.style.left = `${node.x}px`;
    element.style.top = `${node.y}px`;
  }

  function getNodeWidth(node) {
    return Math.min(280, Math.max(220, 220 + Math.min(40, (node.title || "").length * 2)));
  }

  function getNodeHeight(node) {
    const lines = Math.max(1, Math.ceil(((node.note || "").length + 24) / 46));
    return 120 + Math.min(64, lines * 18);
  }

  function getViewportCenter() {
    return {
      x: workspace.scrollLeft + workspace.clientWidth / 2,
      y: workspace.scrollTop + workspace.clientHeight / 2,
    };
  }

  function toScenePoint(event) {
    const rect = workspace.getBoundingClientRect();
    const x = event.clientX - rect.left + workspace.scrollLeft;
    const y = event.clientY - rect.top + workspace.scrollTop;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    return { x, y };
  }

  function pickColor() {
    const index = state.graph?.nodes?.length ?? 0;
    return DEFAULT_COLORS[index % DEFAULT_COLORS.length];
  }

  function nextNodeTitle() {
    const number = state.graph.nodes.length + 1;
    return `Блок ${number}`;
  }

  function createId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return `${prefix}-${window.crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function isTypingInField() {
    const active = document.activeElement;
    return (
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLElement && active.isContentEditable)
    );
  }
})();
