export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface JsonSchema {
  $id?: string;
  $schema?: string;
  $ref?: string;
  title?: string;
  description?: string;
  type?: string | string[];
  format?: string;
  properties?: Record<string, JsonSchema>;
  patternProperties?: Record<string, JsonSchema>;
  required?: string[];
  prefixItems?: JsonSchema[];
  items?: JsonSchema | JsonSchema[] | boolean;
  enum?: JsonValue[];
  const?: JsonValue;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  definitions?: Record<string, JsonSchema>;
  $defs?: Record<string, JsonSchema>;
  [key: string]: unknown;
}

export type SchemaNodeKind = 'object' | 'array' | 'combinator' | 'enum' | 'ref-target';

export interface SchemaRow {
  id: string;
  label: string;
  typeLabel: string;
  pointer: string;
  resolvedPointer?: string;
  required: boolean;
  relation: string;
  description?: string;
  detailLines: string[];
  handleId?: string;
  childNodeId?: string;
  childNodeIds?: string[];
  schema: JsonSchema;
}

export interface SchemaGraphNode {
  id: string;
  kind: SchemaNodeKind;
  pointer: string;
  title: string;
  subtitle: string;
  description?: string;
  rows: SchemaRow[];
  metaLines: string[];
  schema: JsonSchema;
  enumValues: string[];
  isEmbedded?: boolean;
  ownerNodeId: string;
  size: {
    width: number;
    height: number;
  };
}

export interface SchemaGraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  sourceRowId?: string;
  label?: string;
  labelPosition?: 'center' | 'source';
}

export interface SchemaGraphModel {
  rootNodeId: string;
  nodes: SchemaGraphNode[];
  edges: SchemaGraphEdge[];
  warnings: string[];
  nodeMap: Record<string, SchemaGraphNode>;
  rowMap: Record<string, SchemaRow>;
}

export type SchemaSelection =
  | {
      kind: 'node';
      nodeId: string;
    }
  | {
      kind: 'row';
      nodeId: string;
      rowId: string;
    };

export interface SelectionDetails {
  heading: string;
  badge: string;
  description?: string;
  facts: string[];
  schemaPointer: string;
  jsonPointer: string;
  schema: JsonSchema;
}
