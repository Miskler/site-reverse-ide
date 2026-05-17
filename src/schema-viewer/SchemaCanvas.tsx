import {
  ReactFlow,
  Controls,
  type ReactFlowInstance,
} from '@xyflow/react';
import { useEffect, useMemo, useRef } from 'react';
import { createTargetHandleId } from './handle-ids';
import { getPresentationNode, shouldRenderNode } from './node-presentation';
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

const SCHEMA_MIN_ZOOM = 0.0666666667;

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
  const initialFitPendingRef = useRef(true);
  const visibleNodeIds = useMemo(
    () =>
      new Set(
        model.nodes
          .filter((node) => !node.isEmbedded && shouldRenderNode(model.nodeMap, node))
          .map((node) => node.id),
      ),
    [model.nodeMap, model.nodes],
  );

  function fitCanvas(instance: ReactFlowInstance<SchemaNodeType, SchemaEdgeType>) {
    void instance.fitView({
      duration: 250,
      padding: 0.18,
      minZoom: SCHEMA_MIN_ZOOM,
      maxZoom: 1.15,
    });
  }

  useEffect(() => {
    if (!reactFlowRef.current || initialFitPendingRef.current) {
      return;
    }

    fitCanvas(reactFlowRef.current);
  }, [revision]);

  useEffect(() => {
    if (!reactFlowRef.current || !focusNodeRequest) {
      return;
    }

    const focusedNode = model.nodeMap[focusNodeRequest.nodeId];
    const renderNodeId =
      focusedNode && visibleNodeIds.has(focusedNode.id)
        ? focusedNode.id
        : focusedNode?.ownerNodeId && visibleNodeIds.has(focusedNode.ownerNodeId)
          ? focusedNode.ownerNodeId
          : focusNodeRequest.nodeId;
    const node = model.nodeMap[renderNodeId];
    const position = positions[renderNodeId];

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
  }, [focusNodeRequest, model.nodeMap, positions, visibleNodeIds]);

  const nodes: SchemaNodeType[] = useMemo(
    () =>
      model.nodes
        .filter((node) => !node.isEmbedded && shouldRenderNode(model.nodeMap, node))
        .map((node) => {
          const presentationNode = getPresentationNode(model.nodeMap, node);

          return {
            id: node.id,
            type: 'schema',
            data: {
              schemaNode: node,
              nodeMap: model.nodeMap,
              selection,
              onSelectNode,
              onSelectRow,
              isSelectedNode:
                selection?.kind === 'node' &&
                (selection.nodeId === node.id || selection.nodeId === presentationNode.id),
              isSelectedRow:
                selection?.kind === 'row' && selection.nodeId === presentationNode.id,
            },
            position: positions[node.id] ?? { x: 0, y: 0 },
            draggable: false,
            selectable: true,
            style: {
              width: node.size.width,
              height: node.size.height,
            },
          };
        }),
    [model.nodeMap, model.nodes, onSelectNode, onSelectRow, positions, selection],
  );

  const edges: SchemaEdgeType[] = useMemo(
    () =>
      model.edges.flatMap((edge) => {
        const sourceNode = model.nodeMap[edge.source];
        const targetNode = model.nodeMap[edge.target];

        if (!sourceNode || !targetNode || targetNode.isEmbedded) {
          return [];
        }

        const renderSourceNodeId = sourceNode.isEmbedded
          ? sourceNode.ownerNodeId
          : sourceNode.id;

        if (!visibleNodeIds.has(renderSourceNodeId) || !visibleNodeIds.has(targetNode.id)) {
          return [];
        }

        return [
          {
            id: edge.id,
            source: renderSourceNodeId,
            target: edge.target,
            sourceHandle: edge.sourceHandle,
            targetHandle: createTargetHandleId(edge.target),
            type: 'relation',
            label: edge.label,
            data: edge.labelPosition ? { labelPosition: edge.labelPosition } : undefined,
            selectable: false,
          },
        ];
      }),
    [model.edges, model.nodeMap, visibleNodeIds],
  );

  return (
    <ReactFlow<SchemaNodeType, SchemaEdgeType>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onInit={(instance) => {
        reactFlowRef.current = instance;
        if (initialFitPendingRef.current) {
          requestAnimationFrame(() => {
            fitCanvas(instance);
          });
          initialFitPendingRef.current = false;
        }
      }}
      onNodeClick={(_, node) => {
        const presentationNode = getPresentationNode(node.data.nodeMap, node.data.schemaNode);
        onSelectNode(presentationNode.id);
      }}
      onPaneClick={onClearSelection}
      nodesConnectable={false}
      nodesDraggable={false}
      elementsSelectable={false}
      panOnDrag
      panOnScroll={false}
      zoomOnScroll
      minZoom={SCHEMA_MIN_ZOOM}
      className="schema-canvas"
    >
      <Controls className="graph-controls" />
    </ReactFlow>
  );
}
