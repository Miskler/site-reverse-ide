import {
  ReactFlow,
  Controls,
  type ReactFlowInstance,
} from '@xyflow/react';
import { useEffect, useMemo, useRef } from 'react';
import { createTargetHandleId } from './handle-ids';
import type { NodePositions } from './layout';
import type { SchemaGraphModel, SchemaSelection } from './schema-types';
import { SchemaNode, type SchemaNodeType } from './SchemaNode';
import { SchemaRelationEdge, type SchemaEdgeType } from './SchemaRelationEdge';

interface SchemaCanvasProps {
  model: SchemaGraphModel;
  positions: NodePositions;
  selection: SchemaSelection | null;
  revision: number;
  focusNodeRequest: { nodeId: string; token: number } | null;
  onSelectNode: (nodeId: string) => void;
  onSelectRow: (nodeId: string, rowId: string) => void;
  onClearSelection: () => void;
}

const nodeTypes = {
  schema: SchemaNode,
};

const edgeTypes = {
  relation: SchemaRelationEdge,
};

export function SchemaCanvas({
  model,
  positions,
  selection,
  revision,
  focusNodeRequest,
  onSelectNode,
  onSelectRow,
  onClearSelection,
}: SchemaCanvasProps) {
  const reactFlowRef = useRef<ReactFlowInstance<SchemaNodeType, SchemaEdgeType> | null>(null);

  useEffect(() => {
    if (!reactFlowRef.current) {
      return;
    }

    void reactFlowRef.current.fitView({
      duration: 250,
      padding: 0.18,
      minZoom: 0.2,
      maxZoom: 1.15,
    });
  }, [revision]);

  useEffect(() => {
    if (!reactFlowRef.current || !focusNodeRequest) {
      return;
    }

    const node = model.nodeMap[focusNodeRequest.nodeId];
    const position = positions[focusNodeRequest.nodeId];

    if (!node || !position) {
      return;
    }

    const zoom = reactFlowRef.current.getZoom();

    reactFlowRef.current.setCenter(
      position.x + node.size.width / 2,
      position.y + node.size.height / 2,
      {
        zoom,
        duration: 250,
      },
    );
  }, [focusNodeRequest, model.nodeMap, positions]);

  const nodes: SchemaNodeType[] = useMemo(
    () =>
      model.nodes.map((node) => ({
        id: node.id,
        type: 'schema',
        data: {
          schemaNode: node,
          selection,
          onSelectNode,
          onSelectRow,
          isSelectedNode: selection?.kind === 'node' && selection.nodeId === node.id,
          isSelectedRow: selection?.kind === 'row' && selection.nodeId === node.id,
        },
        position: positions[node.id] ?? { x: 0, y: 0 },
        draggable: false,
        selectable: true,
        style: {
          width: node.size.width,
          height: node.size.height,
        },
      })),
    [model.nodes, onSelectNode, onSelectRow, positions, selection],
  );

  const edges: SchemaEdgeType[] = useMemo(
    () =>
      model.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: createTargetHandleId(edge.target),
        type: 'relation',
        label: edge.label,
        data: edge.labelPosition ? { labelPosition: edge.labelPosition } : undefined,
        selectable: false,
      })),
    [model.edges],
  );

  return (
    <ReactFlow<SchemaNodeType, SchemaEdgeType>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onInit={(instance) => {
        reactFlowRef.current = instance;
      }}
      onNodeClick={(_, node) => {
        onSelectNode(node.id);
      }}
      onPaneClick={onClearSelection}
      nodesConnectable={false}
      nodesDraggable={false}
      elementsSelectable={false}
      panOnDrag
      panOnScroll={false}
      zoomOnScroll
      className="schema-canvas"
    >
      <Controls />
    </ReactFlow>
  );
}
