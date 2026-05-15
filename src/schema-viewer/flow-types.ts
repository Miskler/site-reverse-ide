import type { SchemaGraphNode, SchemaSelection } from './schema-types';

export interface FlowNodeData extends Record<string, unknown> {
  schemaNode: SchemaGraphNode;
  selection: SchemaSelection | null;
  onSelectNode: (nodeId: string) => void;
  onSelectRow: (nodeId: string, rowId: string) => void;
  isSelectedNode: boolean;
  isSelectedRow: boolean;
}
