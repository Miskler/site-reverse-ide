import {
  BaseEdge,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';

export function CanvasEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
}: EdgeProps) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.32,
  });

  return (
    <BaseEdge
      id={id}
      path={path}
      interactionWidth={28}
      className={`graph-edge__path${selected ? ' is-selected' : ''}`}
    />
  );
}
