import ELK from 'elkjs/lib/elk.bundled.js';
import { createTargetHandleId } from './handle-ids';
import type { SchemaGraphModel } from './schema-types';

export interface NodePositions {
  [nodeId: string]: {
    x: number;
    y: number;
  };
}

const elk = new ELK();
const PORT_SIZE = 10;

export async function layoutSchemaGraph(model: SchemaGraphModel): Promise<NodePositions> {
  const visibleNodes = model.nodes.filter((node) => !node.isEmbedded);
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));

  const graph = await elk.layout({
    id: 'schema-root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.layered.spacing.nodeNodeBetweenLayers': '132',
      'elk.spacing.nodeNode': '68',
      'elk.spacing.edgeNode': '40',
      'elk.padding': '[top=28,left=28,bottom=28,right=28]',
      'elk.edgeRouting': 'SPLINES',
    },
    children: visibleNodes.map((node) => ({
      id: node.id,
      width: node.size.width,
      height: node.size.height,
      layoutOptions: {
        'org.eclipse.elk.portConstraints': 'FIXED_ORDER',
      },
      ports: [
        {
          id: createTargetHandleId(node.id),
          width: PORT_SIZE,
          height: PORT_SIZE,
          layoutOptions: {
            'org.eclipse.elk.port.side': 'WEST',
          },
        },
        ...collectPortsForOwner(model, node.id),
      ],
    })),
    edges: model.edges.flatMap((edge) => {
      const sourceNode = model.nodeMap[edge.source];
      const targetNode = model.nodeMap[edge.target];

      if (!sourceNode || !targetNode || targetNode.isEmbedded) {
        return [];
      }

      const renderSourceNodeId = sourceNode.isEmbedded
        ? sourceNode.ownerNodeId
        : sourceNode.id;

      if (!visibleNodeIds.has(renderSourceNodeId)) {
        return [];
      }

      return [
        {
          id: edge.id,
          sources: [edge.sourceHandle ?? renderSourceNodeId],
          targets: [createTargetHandleId(edge.target)],
        },
      ];
    }),
  });

  const positions: NodePositions = {};

  for (const child of graph.children ?? []) {
    positions[child.id] = {
      x: child.x ?? 0,
      y: child.y ?? 0,
    };
  }

  return positions;
}

function collectPortsForOwner(model: SchemaGraphModel, ownerNodeId: string) {
  return model.nodes
    .filter((node) => node.ownerNodeId === ownerNodeId)
    .flatMap((node) =>
      node.rows
        .filter((row) => row.handleId)
        .map((row) => ({
          id: row.handleId!,
          width: PORT_SIZE,
          height: PORT_SIZE,
          layoutOptions: {
            'org.eclipse.elk.port.side': 'EAST',
          },
        })),
    );
}
