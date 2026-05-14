import { z } from 'zod';
import {
  GRAPH_VERSION,
  normalizeColor,
  normalizePosition,
  normalizeText,
  type GraphDocument,
  type GraphEdge,
  type GraphNode,
} from '../src/shared/graph';

const positionSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
  })
  .strict();

const nodeSchema = z
  .object({
    id: z.string().trim().min(1),
    title: z.string(),
    note: z.string(),
    color: z.string(),
    position: positionSchema,
  })
  .strict();

const edgeSchema = z
  .object({
    id: z.string().trim().min(1),
    source: z.string().trim().min(1),
    target: z.string().trim().min(1),
    sourceHandle: z.string().trim().min(1).optional(),
    targetHandle: z.string().trim().min(1).optional(),
  })
  .strict();

const graphSchema = z
  .object({
    version: z.literal(GRAPH_VERSION),
    nodes: z.array(nodeSchema),
    edges: z.array(edgeSchema),
  })
  .strict();

export class GraphValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphValidationError';
  }
}

export function parseGraphDocument(input: unknown): GraphDocument {
  const parsed = graphSchema.parse(input);

  const nodeIds = new Set<string>();
  const nodes: GraphNode[] = parsed.nodes.map((node) => {
    if (nodeIds.has(node.id)) {
      throw new GraphValidationError(`Duplicate node id: ${node.id}`);
    }

    nodeIds.add(node.id);
    return {
      id: node.id,
      title: normalizeText(node.title, 'Без названия'),
      note: normalizeText(node.note, ''),
      color: normalizeColor(node.color),
      position: normalizePosition(node.position),
    };
  });

  const edges: GraphEdge[] = [];
  const edgeIds = new Set<string>();
  const seenPairs = new Set<string>();

  for (const edge of parsed.edges) {
    if (edgeIds.has(edge.id)) {
      throw new GraphValidationError(`Duplicate edge id: ${edge.id}`);
    }

    edgeIds.add(edge.id);

    if (edge.source === edge.target) {
      continue;
    }

    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      continue;
    }

    const pairKey = `${edge.source}::${edge.target}`;
    if (seenPairs.has(pairKey)) {
      continue;
    }

    seenPairs.add(pairKey);
    edges.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: normalizeText(edge.sourceHandle, 'source') || 'source',
      targetHandle: normalizeText(edge.targetHandle, 'target') || 'target',
    });
  }

  return {
    version: GRAPH_VERSION,
    nodes,
    edges,
  };
}
