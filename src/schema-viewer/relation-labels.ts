import type { SchemaGraphNode, SchemaRow } from './schema-types';

export function getRelationLabel(
  nodeMap: Record<string, SchemaGraphNode> | Map<string, SchemaGraphNode>,
  row: SchemaRow,
): string {
  const childNode = row.childNodeId ? readNode(nodeMap, row.childNodeId) : undefined;

  return getRelationLabelForChild(row.relation, childNode);
}

export function getRelationLabelForChild(
  relation: string,
  childNode?: SchemaGraphNode,
): string {
  if (relation !== 'field' || !childNode) {
    return relation;
  }

  if (childNode.kind === 'array') {
    return 'item';
  }

  if (childNode.kind === 'enum' || childNode.kind === 'combinator') {
    return 'variant';
  }

  return relation;
}

export function getRelationBadge(
  nodeMap: Record<string, SchemaGraphNode> | Map<string, SchemaGraphNode>,
  row: SchemaRow,
): string {
  const relationLabel = getRelationLabel(nodeMap, row);

  return row.required ? `required ${relationLabel}` : relationLabel;
}

function readNode(
  nodeMap: Record<string, SchemaGraphNode> | Map<string, SchemaGraphNode>,
  nodeId: string,
): SchemaGraphNode | undefined {
  return nodeMap instanceof Map ? nodeMap.get(nodeId) : nodeMap[nodeId];
}
