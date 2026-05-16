import type { SchemaGraphNode } from './schema-types';

export function getPresentationNode(
  nodeMap: Record<string, SchemaGraphNode> | Map<string, SchemaGraphNode>,
  schemaNode: SchemaGraphNode,
): SchemaGraphNode {
  return getPromotedEmbeddedChild(nodeMap, schemaNode) ?? schemaNode;
}

export function getPromotedEmbeddedChild(
  nodeMap: Record<string, SchemaGraphNode> | Map<string, SchemaGraphNode>,
  schemaNode: SchemaGraphNode,
): SchemaGraphNode | null {
  if (schemaNode.kind !== 'array') {
    return null;
  }

  if ((schemaNode.schema.prefixItems?.length ?? 0) > 0) {
    return null;
  }

  if (schemaNode.rows.length !== 1) {
    return null;
  }

  const row = schemaNode.rows[0];

  if (!row?.childNodeId) {
    return null;
  }

  const childNode = readNode(nodeMap, row.childNodeId);

  if (!childNode || !childNode.isEmbedded || childNode.kind === 'array') {
    return null;
  }

  return childNode;
}

function readNode(
  nodeMap: Record<string, SchemaGraphNode> | Map<string, SchemaGraphNode>,
  nodeId: string,
): SchemaGraphNode | undefined {
  return nodeMap instanceof Map ? nodeMap.get(nodeId) : nodeMap[nodeId];
}
