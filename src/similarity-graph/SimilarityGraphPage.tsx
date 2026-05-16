import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
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
import { InspectorShell } from '../components/InspectorShell';
import { readIntegerCookie, writeCookie } from '../lib/cookies';
import type { GraphDocument } from '../shared/graph';
import { createNodeRawJson, normalizeText } from '../shared/graph';

interface SimilarityGraphPageProps {
  graph: GraphDocument | null;
  busy: boolean;
  loadError: string | null;
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
  note: string;
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

interface SimilarityGraphEdgePayload {
  id: string;
  source: string;
  target: string;
  kind: string;
  score: number;
  percentage: number;
  label: string;
  structure_score: number;
  metadata: {
    shared_tokens: number;
    left_tokens: number;
    right_tokens: number;
  };
}

interface LayoutPoint {
  x: number;
  y: number;
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
  };
}

interface SimilarityNodeData extends Record<string, unknown> {
  label: string;
  description: string;
  note: string;
  nodeTitle: string;
  nodeUid: string;
  variantLabel: string;
  metadata: SimilarityGraphNodeMetadata;
  nodeScale: number;
  strength: number;
  neighborCount: number;
  accentColor: string;
}

interface SimilarityEdgeData extends Record<string, unknown> {
  score: number;
  percentage: number;
}

type SimilarityNodeType = Node<SimilarityNodeData, 'similarityNode'>;
type SimilarityEdgeType = Edge<SimilarityEdgeData, 'similarityEdge'>;
type SimilarityNodeHandleSide = 'left' | 'right' | 'top' | 'bottom';
type SimilarityNodeHandleRole = 'source' | 'target';
type SimilarityNodeHandleId = `${SimilarityNodeHandleSide}-${SimilarityNodeHandleRole}`;

interface SimilarityFlowNodeIndexEntry {
  node: SimilarityNodeType;
  center: LayoutPoint;
}

interface SimilarityHandleChoice {
  handleId: SimilarityNodeHandleId;
  position: Position;
}

interface SimilarityHandlePairChoice {
  source: SimilarityHandleChoice;
  target: SimilarityHandleChoice;
}

const GRAPH_DENSITY_THRESHOLD = 0.2;
const DEFAULT_LAYOUT_SCALE = 1;
const DEFAULT_FOCUS_ZOOM = 1.08;
const DETAILS_PANEL_WIDTH_COOKIE = 'site-reverse-ide-similarity-details-width';
const DETAILS_PANEL_DEFAULT_WIDTH = 340;
const DETAILS_PANEL_MIN_WIDTH = 260;
const DETAILS_PANEL_MAX_WIDTH = 680;
const DETAILS_PANEL_MIN_CANVAS_WIDTH = 420;
const DETAILS_PANEL_KEY_STEP = 24;
const DETAILS_PANEL_KEY_STEP_FAST = 72;
const SOURCE_NODE_WIDTH = 220;
const SOURCE_NODE_HEIGHT = 110;
const MIN_NODE_SCALE = 0.88;
const MAX_NODE_SCALE = 1.55;
const SIMILARITY_EDGE_CURVATURE = 0.28;
const SIMILARITY_AXIS_PREFERENCE_POWER = 0.68;
const SIMILARITY_AXIS_PREFERENCE_SPAN = 2.35;
const SIMILARITY_AXIS_PENALTY_WEIGHT = 2.7;
const SIMILARITY_EDGE_MIN_STROKE_WIDTH = 1.1;
const SIMILARITY_EDGE_STROKE_WIDTH_RANGE = 8.8;
const SIMILARITY_HANDLE_IDS: Record<
  SimilarityNodeHandleSide,
  Record<SimilarityNodeHandleRole, SimilarityNodeHandleId>
> = {
  left: {
    source: 'left-source',
    target: 'left-target',
  },
  right: {
    source: 'right-source',
    target: 'right-target',
  },
  top: {
    source: 'top-source',
    target: 'top-target',
  },
  bottom: {
    source: 'bottom-source',
    target: 'bottom-target',
  },
};

const SIMILARITY_NODE_HANDLE_LAYOUT: Array<{
  id: SimilarityNodeHandleId;
  type: SimilarityNodeHandleRole;
  position: Position;
}> = [
  { id: 'left-target', type: 'target', position: Position.Left },
  { id: 'left-source', type: 'source', position: Position.Left },
  { id: 'right-target', type: 'target', position: Position.Right },
  { id: 'right-source', type: 'source', position: Position.Right },
  { id: 'top-target', type: 'target', position: Position.Top },
  { id: 'top-source', type: 'source', position: Position.Top },
  { id: 'bottom-target', type: 'target', position: Position.Bottom },
  { id: 'bottom-source', type: 'source', position: Position.Bottom },
];
const SIMILARITY_HANDLE_SIDES: SimilarityNodeHandleSide[] = ['left', 'right', 'top', 'bottom'];
const SIMILARITY_SIDE_TO_POSITION: Record<SimilarityNodeHandleSide, Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
};

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

function summarizeNodeNote(note: string): string {
  const compact = normalizeText(note, '').replace(/\s+/g, ' ');
  if (!compact) {
    return 'Без описания';
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
        note: summarizeNodeNote(node.note),
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

function getKeyboardResizeStep(event: ReactKeyboardEvent<HTMLDivElement>): number {
  return event.shiftKey ? DETAILS_PANEL_KEY_STEP_FAST : DETAILS_PANEL_KEY_STEP;
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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getSimilarityNodeScale(totalKeys: number, minKeys: number, maxKeys: number): number {
  const keys = Math.max(1, totalKeys);
  const min = Math.max(1, minKeys);
  const max = Math.max(min, maxKeys);

  if (max <= min) {
    return 1;
  }

  const normalized = Math.max(0, Math.min(1, (keys - min) / (max - min)));
  return MIN_NODE_SCALE + normalized * (MAX_NODE_SCALE - MIN_NODE_SCALE);
}

function getSimilarityNodeCollisionRadius(nodeScale: number): number {
  const width = SOURCE_NODE_WIDTH * nodeScale;
  const height = SOURCE_NODE_HEIGHT * nodeScale;
  return Math.hypot(width, height) * 0.5 + 18;
}

function computeSimilarityCutoff(edges: SimilarityGraphEdgePayload[]): number {
  if (edges.length === 0) {
    return 1;
  }

  const scores = edges.map((edge) => clamp01(edge.score));
  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const variance =
    scores.reduce((sum, score) => sum + ((score - mean) ** 2), 0) / Math.max(1, scores.length);
  const standardDeviation = Math.sqrt(variance);

  return Math.max(0, Math.min(1, mean + standardDeviation * 0.15));
}

function circularMean(angles: number[]): number {
  if (angles.length === 0) {
    return 0;
  }

  let x = 0;
  let y = 0;
  for (const angle of angles) {
    x += Math.cos(angle);
    y += Math.sin(angle);
  }

  return Math.atan2(y, x);
}

function buildClusteredSimilarityPositions(
  nodes: SimilarityGraphNodePayload[],
  edges: SimilarityGraphEdgePayload[],
  nodeScales: Map<string, number>,
): Map<string, LayoutPoint> {
  if (nodes.length === 0) {
    return new Map();
  }

  const basePositions = new Map<string, LayoutPoint>();
  const nodeStrengths = new Map<string, number>();
  const parent = new Map<string, string>();
  const radii = new Map<string, number>();

  for (const node of nodes) {
    basePositions.set(node.id, { x: node.position.x, y: node.position.y });
    nodeStrengths.set(node.id, 0);
    parent.set(node.id, node.id);
    radii.set(node.id, getSimilarityNodeCollisionRadius(nodeScales.get(node.id) ?? 1));
  }

  function findRoot(nodeId: string): string {
    const currentParent = parent.get(nodeId);
    if (!currentParent || currentParent === nodeId) {
      return nodeId;
    }

    const root = findRoot(currentParent);
    parent.set(nodeId, root);
    return root;
  }

  function union(leftId: string, rightId: string): void {
    const leftRoot = findRoot(leftId);
    const rightRoot = findRoot(rightId);

    if (leftRoot !== rightRoot) {
      parent.set(rightRoot, leftRoot);
    }
  }

  for (const edge of edges) {
    const score = clamp01(edge.score);
    nodeStrengths.set(edge.source, (nodeStrengths.get(edge.source) ?? 0) + score);
    nodeStrengths.set(edge.target, (nodeStrengths.get(edge.target) ?? 0) + score);
  }

  const cutoff = computeSimilarityCutoff(edges);
  for (const edge of edges) {
    if (clamp01(edge.score) >= cutoff) {
      union(edge.source, edge.target);
    }
  }

  const clusterMap = new Map<string, string[]>();
  for (const node of nodes) {
    const root = findRoot(node.id);
    const members = clusterMap.get(root) ?? [];
    members.push(node.id);
    clusterMap.set(root, members);
  }

  type ClusterLayout = {
    id: string;
    members: string[];
    targetCenter: LayoutPoint;
    center: LayoutPoint;
    rotation: number;
    density: number;
    localRadius: number;
    extent: number;
    strength: number;
  };

  const baseRadius =
    Array.from(basePositions.values()).reduce((sum, point) => sum + Math.hypot(point.x, point.y), 0) /
      Math.max(1, basePositions.size) || 1;

  const clusters: ClusterLayout[] = Array.from(clusterMap.entries()).map(([root, members]) => {
    const memberPoints = members.map((id) => basePositions.get(id) ?? { x: 0, y: 0 });
    const memberWeights = members.map((id) => 1 + (nodeStrengths.get(id) ?? 0));
    const totalWeight = memberWeights.reduce((sum, weight) => sum + weight, 0) || 1;

    const anchor = memberPoints.reduce(
      (accumulator, point, index) => ({
        x: accumulator.x + point.x * memberWeights[index],
        y: accumulator.y + point.y * memberWeights[index],
      }),
      { x: 0, y: 0 },
    );
    anchor.x /= totalWeight;
    anchor.y /= totalWeight;

    const memberAngles = members.map((id) => {
      const point = basePositions.get(id) ?? { x: 0, y: 0 };
      return Math.atan2(point.y, point.x);
    });
    const rotation = circularMean(memberAngles);

    const internalEdges = edges.filter((edge) => members.includes(edge.source) && members.includes(edge.target));
    const density =
      internalEdges.length === 0
        ? 0
        : internalEdges.reduce((sum, edge) => sum + clamp01(edge.score), 0) / internalEdges.length;
    const averageScale =
      members.reduce((sum, id) => sum + (nodeScales.get(id) ?? 1), 0) / Math.max(1, members.length);
    const averageSpan = SOURCE_NODE_WIDTH * averageScale;

    let pairRequirement = 0;
    for (let leftIndex = 0; leftIndex < members.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < members.length; rightIndex += 1) {
        const leftRadius = radii.get(members[leftIndex]) ?? 0;
        const rightRadius = radii.get(members[rightIndex]) ?? 0;
        pairRequirement = Math.max(pairRequirement, leftRadius + rightRadius + 18);
      }
    }

    if (members.length === 1) {
      pairRequirement = (radii.get(members[0]) ?? 0) * 2 + 18;
    }

    const clusterCenterRadius =
      baseRadius * (0.96 + density * 0.18 + Math.max(0, members.length - 1) * 0.035) + averageSpan * 0.045;
    const directionalCenter = {
      x: Math.cos(rotation) * clusterCenterRadius,
      y: Math.sin(rotation) * clusterCenterRadius,
    };
    const targetCenter = {
      x: anchor.x * 0.38 + directionalCenter.x * 0.62,
      y: anchor.y * 0.38 + directionalCenter.y * 0.62,
    };

    const minPolygonRadius =
      members.length <= 1
        ? 0
        : pairRequirement / (2 * Math.sin(Math.PI / members.length));
    const localRadius =
      members.length <= 1
        ? 0
        : Math.max(
            minPolygonRadius * 1.04,
            pairRequirement * 0.54,
            82 + members.length * 16 + (1 - density) * 28,
          );
    const extent =
      members.length <= 1
        ? pairRequirement * 0.5
        : localRadius + Math.max(...members.map((id) => radii.get(id) ?? 0)) + 20;
    const strength =
      internalEdges.reduce((sum, edge) => sum + clamp01(edge.score), 0) / Math.max(1, internalEdges.length);

    return {
      id: root,
      members,
      targetCenter,
      center: { x: targetCenter.x, y: targetCenter.y },
      rotation,
      density,
      localRadius,
      extent,
      strength,
    };
  });

  clusters.sort((left, right) => {
    if (right.members.length !== left.members.length) {
      return right.members.length - left.members.length;
    }

    return right.strength - left.strength;
  });

  const clusterIterations = Math.max(10, Math.min(28, Math.round(nodes.length * 3.5)));
  const clusterPull = 0.05;
  const clusterGap = 36;

  function fallbackDirection(leftId: string, rightId: string): LayoutPoint {
    const seed = `${leftId}::${rightId}`;
    let hash = 0;

    for (let index = 0; index < seed.length; index += 1) {
      hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
    }

    const angle = (hash % 360) * (Math.PI / 180);
    return {
      x: Math.cos(angle) || 1,
      y: Math.sin(angle),
    };
  }

  for (let iteration = 0; iteration < clusterIterations; iteration += 1) {
    for (let leftIndex = 0; leftIndex < clusters.length; leftIndex += 1) {
      const leftCluster = clusters[leftIndex];

      for (let rightIndex = leftIndex + 1; rightIndex < clusters.length; rightIndex += 1) {
        const rightCluster = clusters[rightIndex];
        const dx = rightCluster.center.x - leftCluster.center.x;
        const dy = rightCluster.center.y - leftCluster.center.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const requiredDistance = leftCluster.extent + rightCluster.extent + clusterGap;

        if (distance >= requiredDistance) {
          continue;
        }

        const overlap = requiredDistance - distance;
        const direction =
          distance > 0.001
            ? { x: dx / distance, y: dy / distance }
            : fallbackDirection(leftCluster.id, rightCluster.id);
        const leftWeight = Math.max(1, leftCluster.extent);
        const rightWeight = Math.max(1, rightCluster.extent);
        const totalWeight = leftWeight + rightWeight;
        const leftShift = overlap * (rightWeight / totalWeight);
        const rightShift = overlap * (leftWeight / totalWeight);

        leftCluster.center.x -= direction.x * leftShift;
        leftCluster.center.y -= direction.y * leftShift;
        rightCluster.center.x += direction.x * rightShift;
        rightCluster.center.y += direction.y * rightShift;
      }
    }

    for (const cluster of clusters) {
      cluster.center.x += (cluster.targetCenter.x - cluster.center.x) * clusterPull;
      cluster.center.y += (cluster.targetCenter.y - cluster.center.y) * clusterPull;
    }

    const centerX = clusters.reduce((sum, cluster) => sum + cluster.center.x, 0) / Math.max(1, clusters.length);
    const centerY = clusters.reduce((sum, cluster) => sum + cluster.center.y, 0) / Math.max(1, clusters.length);

    for (const cluster of clusters) {
      cluster.center.x -= centerX;
      cluster.center.y -= centerY;
    }
  }

  const positions = new Map<string, LayoutPoint>();
  const regularRotation = Math.PI * (3 - Math.sqrt(5));

  for (const cluster of clusters) {
    const sortedMembers = [...cluster.members].sort((leftId, rightId) => {
      const leftStrength = nodeStrengths.get(leftId) ?? 0;
      const rightStrength = nodeStrengths.get(rightId) ?? 0;
      if (rightStrength !== leftStrength) {
        return rightStrength - leftStrength;
      }

      return leftId.localeCompare(rightId);
    });

    if (sortedMembers.length === 1) {
      positions.set(sortedMembers[0], {
        x: cluster.center.x,
        y: cluster.center.y,
      });
      continue;
    }

    const baseRotation = cluster.rotation + regularRotation * 0.12;
    const memberCount = sortedMembers.length;

    sortedMembers.forEach((memberId, index) => {
      const angle = baseRotation + (Math.PI * 2 * index) / memberCount;
      positions.set(memberId, {
        x: cluster.center.x + Math.cos(angle) * cluster.localRadius,
        y: cluster.center.y + Math.sin(angle) * cluster.localRadius,
      });
    });
  }

  const recenterX = Array.from(positions.values()).reduce((sum, point) => sum + point.x, 0) / Math.max(1, positions.size);
  const recenterY = Array.from(positions.values()).reduce((sum, point) => sum + point.y, 0) / Math.max(1, positions.size);

  for (const point of positions.values()) {
    point.x -= recenterX;
    point.y -= recenterY;
  }

  return positions;
}

function scaleLayoutPosition(
  position: { x: number; y: number },
  scale: number,
  nodeScale: number,
): { x: number; y: number } {
  return {
    x: position.x * scale - (SOURCE_NODE_WIDTH * nodeScale) / 2,
    y: position.y * scale - (SOURCE_NODE_HEIGHT * nodeScale) / 2,
  };
}

function getSimilarityNodeCenter(node: SimilarityNodeType): LayoutPoint {
  const nodeScale = Math.max(0.01, node.data.nodeScale ?? 1);

  return {
    x: node.position.x + (SOURCE_NODE_WIDTH * nodeScale) / 2,
    y: node.position.y + (SOURCE_NODE_HEIGHT * nodeScale) / 2,
  };
}

function getSimilarityNodeSize(node: SimilarityNodeType): { width: number; height: number } {
  const nodeScale = Math.max(0.01, node.data.nodeScale ?? 1);

  return {
    width: SOURCE_NODE_WIDTH * nodeScale,
    height: SOURCE_NODE_HEIGHT * nodeScale,
  };
}

function getSimilarityNodeBounds(node: SimilarityNodeType): { left: number; right: number; top: number; bottom: number } {
  const size = getSimilarityNodeSize(node);

  return {
    left: node.position.x,
    right: node.position.x + size.width,
    top: node.position.y,
    bottom: node.position.y + size.height,
  };
}

function getSimilarityHandlePoint(
  center: LayoutPoint,
  size: { width: number; height: number },
  side: SimilarityNodeHandleSide,
): LayoutPoint {
  switch (side) {
    case 'left':
      return { x: center.x - size.width / 2, y: center.y };
    case 'right':
      return { x: center.x + size.width / 2, y: center.y };
    case 'top':
      return { x: center.x, y: center.y - size.height / 2 };
    case 'bottom':
      return { x: center.x, y: center.y + size.height / 2 };
  }
}

function getSimilarityHandleNormal(side: SimilarityNodeHandleSide): LayoutPoint {
  switch (side) {
    case 'left':
      return { x: -1, y: 0 };
    case 'right':
      return { x: 1, y: 0 };
    case 'top':
      return { x: 0, y: -1 };
    case 'bottom':
      return { x: 0, y: 1 };
  }
}

function isVerticalSimilaritySide(side: SimilarityNodeHandleSide): boolean {
  return side === 'top' || side === 'bottom';
}

function normalizeLayoutVector(vector: LayoutPoint): LayoutPoint {
  const length = Math.hypot(vector.x, vector.y);
  if (length === 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
  };
}

function distanceBetweenPoints(left: LayoutPoint, right: LayoutPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function distancePointToRect(point: LayoutPoint, rect: { left: number; right: number; top: number; bottom: number }): number {
  const dx =
    point.x < rect.left ? rect.left - point.x : point.x > rect.right ? point.x - rect.right : 0;
  const dy =
    point.y < rect.top ? rect.top - point.y : point.y > rect.bottom ? point.y - rect.bottom : 0;

  return Math.hypot(dx, dy);
}

function sampleSimilarityBezier(
  sourcePoint: LayoutPoint,
  sourceControl: LayoutPoint,
  targetControl: LayoutPoint,
  targetPoint: LayoutPoint,
  t: number,
): LayoutPoint {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  const a = mt2 * mt;
  const b = 3 * mt2 * t;
  const c = 3 * mt * t2;
  const d = t2 * t;

  return {
    x: a * sourcePoint.x + b * sourceControl.x + c * targetControl.x + d * targetPoint.x,
    y: a * sourcePoint.y + b * sourceControl.y + c * targetControl.y + d * targetPoint.y,
  };
}

function estimateSimilarityBezierBulge(
  sourcePoint: LayoutPoint,
  sourceControl: LayoutPoint,
  targetControl: LayoutPoint,
  targetPoint: LayoutPoint,
): number {
  const chordDx = targetPoint.x - sourcePoint.x;
  const chordDy = targetPoint.y - sourcePoint.y;
  const chordLength = Math.max(1, Math.hypot(chordDx, chordDy));
  const samples = [0.2, 0.35, 0.5, 0.65, 0.8];
  let maxDeviation = 0;

  for (const t of samples) {
    const point = sampleSimilarityBezier(sourcePoint, sourceControl, targetControl, targetPoint, t);
    const deviation = Math.abs((point.x - sourcePoint.x) * chordDy - (point.y - sourcePoint.y) * chordDx) / chordLength;
    maxDeviation = Math.max(maxDeviation, deviation);
  }

  return maxDeviation;
}

function estimateSimilarityArcClearancePenalty(
  sourcePoint: LayoutPoint,
  sourceControl: LayoutPoint,
  targetControl: LayoutPoint,
  targetPoint: LayoutPoint,
  sourceNode: SimilarityNodeType,
  targetNode: SimilarityNodeType,
  allNodes: SimilarityNodeType[],
): number {
  const sizeBias = (getSimilarityNodeSize(sourceNode).width + getSimilarityNodeSize(sourceNode).height + getSimilarityNodeSize(targetNode).width + getSimilarityNodeSize(targetNode).height) / 4;
  const desiredClearance = Math.max(16, Math.min(46, sizeBias * 0.18));
  const samplePoints = [0.12, 0.25, 0.38, 0.5, 0.62, 0.75, 0.88];
  let minDistance = Number.POSITIVE_INFINITY;

  for (const otherNode of allNodes) {
    if (otherNode.id === sourceNode.id || otherNode.id === targetNode.id) {
      continue;
    }

    const bounds = getSimilarityNodeBounds(otherNode);
    for (const t of samplePoints) {
      const point = sampleSimilarityBezier(sourcePoint, sourceControl, targetControl, targetPoint, t);
      minDistance = Math.min(minDistance, distancePointToRect(point, bounds));
    }
  }

  if (!Number.isFinite(minDistance)) {
    return 0;
  }

  if (minDistance >= desiredClearance) {
    return 0;
  }

  return (desiredClearance - minDistance) / desiredClearance;
}

function getSimilarityBezierControl(
  point: LayoutPoint,
  otherPoint: LayoutPoint,
  position: Position,
): LayoutPoint {
  const controlOffset = (distance: number) => {
    if (distance >= 0) {
      return 0.5 * distance;
    }

    return SIMILARITY_EDGE_CURVATURE * 25 * Math.sqrt(-distance);
  };

  switch (position) {
    case Position.Left:
      return { x: point.x - controlOffset(point.x - otherPoint.x), y: point.y };
    case Position.Right:
      return { x: point.x + controlOffset(otherPoint.x - point.x), y: point.y };
    case Position.Top:
      return { x: point.x, y: point.y - controlOffset(point.y - otherPoint.y) };
    case Position.Bottom:
      return { x: point.x, y: point.y + controlOffset(otherPoint.y - point.y) };
  }
}

function getSimilarityHandlePairScore(
  sourceNode: SimilarityNodeType,
  targetNode: SimilarityNodeType,
  sourceSide: SimilarityNodeHandleSide,
  targetSide: SimilarityNodeHandleSide,
  allNodes: SimilarityNodeType[],
): number {
  const sourceCenter = getSimilarityNodeCenter(sourceNode);
  const targetCenter = getSimilarityNodeCenter(targetNode);
  const sourceSize = getSimilarityNodeSize(sourceNode);
  const targetSize = getSimilarityNodeSize(targetNode);
  const sourcePoint = getSimilarityHandlePoint(sourceCenter, sourceSize, sourceSide);
  const targetPoint = getSimilarityHandlePoint(targetCenter, targetSize, targetSide);
  const sourceControl = getSimilarityBezierControl(sourcePoint, targetPoint, SIMILARITY_SIDE_TO_POSITION[sourceSide]);
  const targetControl = getSimilarityBezierControl(targetPoint, sourcePoint, SIMILARITY_SIDE_TO_POSITION[targetSide]);
  const sourceVector = normalizeLayoutVector({
    x: targetCenter.x - sourceCenter.x,
    y: targetCenter.y - sourceCenter.y,
  });
  const targetVector = normalizeLayoutVector({
    x: sourceCenter.x - targetCenter.x,
    y: sourceCenter.y - targetCenter.y,
  });
  const sourceNormal = getSimilarityHandleNormal(sourceSide);
  const targetNormal = getSimilarityHandleNormal(targetSide);
  const sourceAlignment = Math.max(0, sourceVector.x * sourceNormal.x + sourceVector.y * sourceNormal.y);
  const targetAlignment = Math.max(0, targetVector.x * targetNormal.x + targetVector.y * targetNormal.y);
  const sourceAlignmentPenalty = Math.pow(1 - sourceAlignment, 1.65);
  const targetAlignmentPenalty = Math.pow(1 - targetAlignment, 1.65);
  const controlPolygonLength =
    distanceBetweenPoints(sourcePoint, sourceControl) +
    distanceBetweenPoints(sourceControl, targetControl) +
    distanceBetweenPoints(targetControl, targetPoint);
  const directHandleLength = distanceBetweenPoints(sourcePoint, targetPoint);
  const sizeBias = (sourceSize.width + sourceSize.height + targetSize.width + targetSize.height) / 4;
  const chordLength = Math.max(1, distanceBetweenPoints(sourceCenter, targetCenter));
  const absDx = Math.abs(targetCenter.x - sourceCenter.x);
  const absDy = Math.abs(targetCenter.y - sourceCenter.y);
  const totalAxisDistance = Math.max(1, absDx + absDy);
  const verticalPressure =
    Math.pow(absDy / totalAxisDistance, SIMILARITY_AXIS_PREFERENCE_POWER) *
    (1 - clamp01(absDx / Math.max(1, Math.min(sourceSize.width, targetSize.width) * SIMILARITY_AXIS_PREFERENCE_SPAN)));
  const horizontalPressure =
    Math.pow(absDx / totalAxisDistance, SIMILARITY_AXIS_PREFERENCE_POWER) *
    (1 - clamp01(absDy / Math.max(1, Math.min(sourceSize.height, targetSize.height) * SIMILARITY_AXIS_PREFERENCE_SPAN)));
  const preferredSourceSide: SimilarityNodeHandleSide = targetCenter.y < sourceCenter.y ? 'top' : 'bottom';
  const preferredTargetSide: SimilarityNodeHandleSide = targetCenter.x >= sourceCenter.x ? 'right' : 'left';
  const sourceDirectionPenalty =
    sourceSide === preferredSourceSide ? 0 : verticalPressure * sizeBias * SIMILARITY_AXIS_PENALTY_WEIGHT;
  const targetDirectionPenalty =
    targetSide === preferredTargetSide ? 0 : horizontalPressure * sizeBias * SIMILARITY_AXIS_PENALTY_WEIGHT;
  const bulge = estimateSimilarityBezierBulge(sourcePoint, sourceControl, targetControl, targetPoint);
  const arcBudget = Math.max(14, Math.min(54, chordLength * 0.18 + sizeBias * 0.08));
  const steepnessPenalty =
    (Math.max(0, bulge - arcBudget) / Math.max(1, arcBudget)) * sizeBias * (0.9 + Math.max(verticalPressure, horizontalPressure) * 0.35);
  const clearancePenalty =
    estimateSimilarityArcClearancePenalty(
      sourcePoint,
      sourceControl,
      targetControl,
      targetPoint,
      sourceNode,
      targetNode,
      allNodes,
    ) * sizeBias * 1.1;

  return (
    controlPolygonLength +
    directHandleLength * 0.08 +
    (sourceAlignmentPenalty + targetAlignmentPenalty) * sizeBias * 0.18 +
    steepnessPenalty +
    clearancePenalty +
    sourceDirectionPenalty +
    targetDirectionPenalty
  );
}

function chooseSimilarityHandlePair(
  sourceNode: SimilarityNodeType,
  targetNode: SimilarityNodeType,
  allNodes: SimilarityNodeType[],
): SimilarityHandlePairChoice {
  let bestScore = Number.POSITIVE_INFINITY;
  let bestChoice: SimilarityHandlePairChoice | null = null;

  for (const sourceSide of SIMILARITY_HANDLE_SIDES) {
    for (const targetSide of SIMILARITY_HANDLE_SIDES) {
      const score = getSimilarityHandlePairScore(sourceNode, targetNode, sourceSide, targetSide, allNodes);
      if (score >= bestScore) {
        continue;
      }

      bestScore = score;
      bestChoice = {
        source: {
          handleId: SIMILARITY_HANDLE_IDS[sourceSide].source,
          position: SIMILARITY_SIDE_TO_POSITION[sourceSide],
        },
        target: {
          handleId: SIMILARITY_HANDLE_IDS[targetSide].target,
          position: SIMILARITY_SIDE_TO_POSITION[targetSide],
        },
      };
    }
  }

  return (
    bestChoice ?? {
      source: {
        handleId: SIMILARITY_HANDLE_IDS.right.source,
        position: Position.Right,
      },
      target: {
        handleId: SIMILARITY_HANDLE_IDS.left.target,
        position: Position.Left,
      },
    }
  );
}

export function SimilarityGraphPage({
  graph,
  busy,
  loadError,
  onNavigateSchemaNode,
}: SimilarityGraphPageProps) {
  const [graphResponse, setGraphResponse] = useState<SimilarityGraphResponse | null>(null);
  const [graphBusy, setGraphBusy] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [detailsWidth, setDetailsWidth] = useState<number>(() => getInitialDetailsWidth());
  const [isResizing, setIsResizing] = useState(false);
  const reactFlowRef = useRef<ReactFlowInstance<SimilarityNodeType, SimilarityEdgeType> | null>(null);
  const requestTokenRef = useRef(0);
  const resizeSessionRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const threshold = GRAPH_DENSITY_THRESHOLD;

  const sources = useMemo(() => buildSimilaritySources(graph), [graph]);
  const shellStyle = useMemo<CSSProperties>(
    () =>
      ({
        '--schema-viewer-details-width': `${detailsWidth}px`,
      }) as CSSProperties,
    [detailsWidth],
  );
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
    }),
    [sources],
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

  function setAndPersistDetailsWidth(nextWidth: number) {
    const viewportWidth = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerWidth;
    const nextValue = clampWidthForViewport(nextWidth, viewportWidth);
    setDetailsWidth(nextValue);
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
  }, [graph, loadError, requestPayload, sources.length]);

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

  const keyRange = useMemo(() => {
    if (!graphResponse || graphResponse.nodes.length === 0) {
      return { min: 1, max: 1 };
    }

    const values = graphResponse.nodes.map((node) => Math.max(1, node.metadata.total_keys));

    return {
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }, [graphResponse]);

  const nodeScales = useMemo(() => {
    if (!graphResponse) {
      return new Map<string, number>();
    }

    const scales = new Map<string, number>();
    for (const node of graphResponse.nodes) {
      scales.set(node.id, getSimilarityNodeScale(node.metadata.total_keys, keyRange.min, keyRange.max));
    }

    return scales;
  }, [graphResponse, keyRange.max, keyRange.min]);

  const clusteredPositions = useMemo(() => {
    if (!graphResponse) {
      return new Map<string, LayoutPoint>();
    }

    return buildClusteredSimilarityPositions(graphResponse.nodes, graphResponse.edges, nodeScales);
  }, [graphResponse, nodeScales]);

  const flowNodes: SimilarityNodeType[] = useMemo(() => {
    if (!graphResponse) {
      return [];
    }

    return graphResponse.nodes.map((node) => {
      const source = sources[node.metadata.index];
      const strength = nodeStrengths.get(node.id)?.strongest ?? 0;
      const neighborCount = nodeStrengths.get(node.id)?.count ?? 0;
      const nodeScale = nodeScales.get(node.id) ?? 1;
      const clusteredPosition = clusteredPositions.get(node.id) ?? node.position;

      return {
        id: node.id,
        type: 'similarityNode',
        position: scaleLayoutPosition(clusteredPosition, layoutScale, nodeScale),
        data: {
          label: node.label,
          description: node.description,
          note: source?.note ?? normalizeText(node.description, 'Без описания'),
          nodeTitle: source?.nodeTitle ?? node.label,
          nodeUid: source?.nodeUid ?? node.id,
          variantLabel: source?.variantLabel ?? 'основной',
          metadata: node.metadata,
          nodeScale,
          strength,
          neighborCount,
          accentColor: source?.nodeColor ?? '#2f8f83',
        },
        draggable: false,
        selectable: true,
      };
    });
  }, [clusteredPositions, graphResponse, layoutScale, nodeScales, nodeStrengths, sources]);

  const flowNodeIndex = useMemo(() => {
    const index = new Map<string, SimilarityFlowNodeIndexEntry>();

    for (const node of flowNodes) {
      index.set(node.id, {
        node,
        center: getSimilarityNodeCenter(node),
      });
    }

    return index;
  }, [flowNodes]);

  const flowEdges: SimilarityEdgeType[] = useMemo(() => {
    return visibleEdges.map((edge) => {
      const sourceEntry = flowNodeIndex.get(edge.source);
      const targetEntry = flowNodeIndex.get(edge.target);
      const pairChoice =
        sourceEntry && targetEntry ? chooseSimilarityHandlePair(sourceEntry.node, targetEntry.node, flowNodes) : null;
      const sourceChoice =
        pairChoice?.source ?? {
          handleId: SIMILARITY_HANDLE_IDS.right.source,
          position: Position.Right,
        };
      const targetChoice =
        pairChoice?.target ?? {
          handleId: SIMILARITY_HANDLE_IDS.left.target,
          position: Position.Left,
        };

      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: sourceChoice.handleId,
        targetHandle: targetChoice.handleId,
        sourcePosition: sourceChoice.position,
        targetPosition: targetChoice.position,
        type: 'similarityEdge',
        data: {
          score: edge.score,
          percentage: edge.percentage,
        },
        selectable: true,
      };
    });
  }, [flowNodeIndex, visibleEdges]);

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

  function focusFlowNode(nodeId: string) {
    const node = flowNodes.find((current) => current.id === nodeId);
    if (!node || !reactFlowRef.current) {
      return;
    }

    const nodeScale = node.data.nodeScale;

    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);

    reactFlowRef.current.setCenter(
      node.position.x + (SOURCE_NODE_WIDTH * nodeScale) / 2,
      node.position.y + (SOURCE_NODE_HEIGHT * nodeScale) / 2,
      {
        zoom: DEFAULT_FOCUS_ZOOM,
        duration: 220,
      },
    );
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

  function handleInspectorClose() {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
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

  return (
    <div
      className={`schema-viewer-shell${isResizing ? ' schema-viewer-shell--resizing' : ''}`}
      style={shellStyle}
    >
      <main className="schema-viewer-shell__canvas similarity-shell__canvas">
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
            <Controls className="graph-controls" />
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

      <InspectorShell
        eyebrow="Inspector"
        title="Крепость связей"
        badge={
          graphResponse
            ? formatPercent(selectedEdge?.score ?? selectedNode?.data.strength ?? strongestEdge?.score ?? threshold)
            : null
        }
        onAction={selectedEdge || selectedNode ? handleInspectorClose : undefined}
        actionLabel="Close"
      >
        {!graphResponse ? (
          <div className="empty-inspector">
            <p>Здесь появятся детали выбранной пары после расчета графа.</p>
          </div>
        ) : selectedEdge ? (
          <>
            <div className="schema-viewer__section">
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
            </div>

            <div className="schema-viewer__section">
              <div className="schema-viewer__section-head">
                <span className="schema-viewer__label">Детали</span>
              </div>
              <dl className="similarity-shell__facts">
                <div>
                  <dt>Структура</dt>
                  <dd>{formatPercent(selectedEdge.structure_score)}</dd>
                </div>
                <div>
                  <dt>Общие токены</dt>
                  <dd>{selectedEdge.metadata.shared_tokens}</dd>
                </div>
                <div>
                  <dt>Токенов слева</dt>
                  <dd>{selectedEdge.metadata.left_tokens}</dd>
                </div>
                <div>
                  <dt>Токенов справа</dt>
                  <dd>{selectedEdge.metadata.right_tokens}</dd>
                </div>
                <div>
                  <dt>Вес порога</dt>
                  <dd>{formatPercent(threshold)}</dd>
                </div>
              </dl>
            </div>
          </>
        ) : selectedNode ? (
          <>
            <div className="schema-viewer__section">
              <div className="schema-viewer__section-head">
                <span className="schema-viewer__label">Selected</span>
              </div>

              <div className="similarity-shell__source-header">
                <div>
                  <h3 className="similarity-shell__source-heading">{selectedSource?.label ?? selectedNode.data.label}</h3>
                  <p className="schema-viewer__hint">{selectedSource?.note ?? selectedNode.data.note}</p>
                </div>
                <span className="schema-viewer__badge">{formatPercent(selectedNode.data.strength)}</span>
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

            <div className="schema-viewer__section">
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
          </>
        ) : (
          <>
            <div className="schema-viewer__section">
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

            <div className="schema-viewer__section">
              <div className="schema-viewer__section-head">
                <span className="schema-viewer__label">Легенда</span>
              </div>
              <ul className="similarity-shell__legend">
                <li>Толще линия означает более высокое совпадение схем.</li>
                <li>Порог скрывает слабые ребра и очищает шум.</li>
                <li>Клик по ноде показывает ее лучшие соседства.</li>
              </ul>
            </div>
          </>
        )}
      </InspectorShell>
    </div>
  );
}

function SimilarityNode({ data, selected }: NodeProps<SimilarityNodeType>) {
  const tone =
    data.strength >= 0.75 ? 'high' : data.strength >= 0.5 ? 'mid' : data.strength > 0 ? 'low' : 'none';

  return (
    <article
      className={`similarity-node similarity-node--${tone}${selected ? ' is-selected' : ''}`}
      style={{
        '--node-color': data.accentColor,
        '--similarity-node-scale': `${data.nodeScale}`,
      } as CSSProperties}
      title={data.note}
    >
      {SIMILARITY_NODE_HANDLE_LAYOUT.map(({ id, type, position }) => (
        <Handle key={id} id={id} type={type} position={position} className="similarity-node__handle" />
      ))}

      <div className="similarity-node__head">
        <div className="similarity-node__titles">
          <div className="similarity-node__title">{data.label}</div>
          <div className="similarity-node__subtitle">{data.variantLabel}</div>
        </div>
      </div>

      <p className="similarity-node__summary">{data.note}</p>

      <div className="similarity-node__facts">
        <span>{data.metadata.total_keys} keys</span>
        <span>{data.metadata.structural_tokens} tokens</span>
      </div>

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
    curvature: SIMILARITY_EDGE_CURVATURE,
  });

  const score = Math.max(0, Math.min(1, data?.score ?? 0));
  const opacity = Math.max(0.14, Math.min(0.9, 0.12 + score * 0.88));
  const strokeWidth = SIMILARITY_EDGE_MIN_STROKE_WIDTH + score * SIMILARITY_EDGE_STROKE_WIDTH_RANGE;
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
