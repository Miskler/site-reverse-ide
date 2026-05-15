import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';

interface RelationEdgeData extends Record<string, unknown> {
  label?: string;
  labelPosition?: 'center' | 'source';
}

export type SchemaEdgeType = Edge<RelationEdgeData, 'relation'>;

export function SchemaRelationEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
}: EdgeProps<SchemaEdgeType>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <>
      <BaseEdge id={id} path={path} className="schema-edge-stroke" interactionWidth={0} />
      {typeof label === 'string' && label.length > 0 ? (
        <EdgeLabelRenderer>
          <div
            className="schema-edge-label"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
