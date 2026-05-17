import type {
  JsonSchema,
  JsonValue,
  SchemaGraphEdge,
  SchemaGraphModel,
  SchemaGraphNode,
  SchemaNodeKind,
  SchemaRow,
  SchemaSelection,
  SelectionDetails,
} from './schema-types';
import { createSourceHandleId } from './handle-ids';
import { getPresentationNode } from './node-presentation';
import { getRelationBadge, getRelationLabelForChild } from './relation-labels';

const OBJECT_WIDTH = 316;
const ARRAY_WIDTH = 304;
const COMBINATOR_WIDTH = 284;
const ENUM_WIDTH = 190;
const ENUM_MAX_WIDTH = 266;
const REF_WIDTH = 240;
const ENUM_HEADER_HEIGHT = 66;
const ENUM_LIST_VERTICAL_PADDING = 19;
const ENUM_PILL_VERTICAL_CHROME = 18;
const ENUM_PILL_GAP = 8;
const ENUM_PILL_LINE_HEIGHT = 19;
const ENUM_AVERAGE_CHAR_WIDTH = 8;
const ENUM_HORIZONTAL_PADDING = 52;

const SUPPORTED_WARNINGS = new Set([
  'if',
  'then',
  'else',
  'not',
  'dependentSchemas',
  'unevaluatedProperties',
  'unevaluatedItems',
  'propertyNames',
  'contains',
]);

interface BuildContext {
  document: JsonSchema;
  nodes: Map<string, SchemaGraphNode>;
  edges: Map<string, SchemaGraphEdge>;
  warnings: Set<string>;
}

interface ResolveResult {
  schema: JsonSchema;
  ref?: string;
  resolvedPointer?: string;
  brokenRef?: boolean;
}

export function buildSchemaGraph(schema: JsonSchema): SchemaGraphModel {
  const context: BuildContext = {
    document: schema,
    nodes: new Map(),
    edges: new Map(),
    warnings: new Set(),
  };

  collectUnsupportedWarnings(schema, '#', context);

  const rootNodeId = ensureNode(context, '#', true);

  if (!rootNodeId) {
    throw new Error('Unable to create a graph node for the root schema.');
  }

  const nodes = Array.from(context.nodes.values());
  const edges = Array.from(context.edges.values());
  const nodeMap = Object.fromEntries(nodes.map((node) => [node.id, node]));
  const rowMap = Object.fromEntries(
    nodes.flatMap((node) => node.rows.map((row) => [row.id, row])),
  );

  return {
    rootNodeId,
    nodes,
    edges,
    warnings: Array.from(context.warnings.values()),
    nodeMap,
    rowMap,
  };
}

export function getSelectionDetails(
  model: SchemaGraphModel,
  selection: SchemaSelection | null,
): SelectionDetails | null {
  if (!selection) {
    return null;
  }

  if (selection.kind === 'node') {
    const node = model.nodeMap[selection.nodeId];

    if (!node) {
      return null;
    }

    const displayNode = getPresentationNode(model.nodeMap, node);
    const ownerNode = model.nodeMap[node.ownerNodeId];
    const headingNode =
      node.isEmbedded || displayNode !== node ? ownerNode ?? node : displayNode;

    return {
      heading: headingNode.title,
      badge: displayNode.kind,
      description: displayNode.description ?? node.description,
      facts: [displayNode.subtitle, ...displayNode.metaLines].filter(Boolean),
      schemaPointer: displayNode.pointer,
      jsonPointer: extractSourceJsonPointer(displayNode.schema),
      schema: displayNode.schema,
    };
  }

  const row = model.rowMap[selection.rowId];

  if (!row) {
    return null;
  }

  const parent = model.nodeMap[selection.nodeId];

  return {
    heading: row.label,
    badge: getRelationBadge(model.nodeMap, row),
    description: row.description ?? parent?.description,
    facts: [
      parent ? `parent: ${parent.title}` : null,
      row.typeLabel,
      ...row.detailLines,
    ].filter((value): value is string => Boolean(value)),
    schemaPointer: row.resolvedPointer ?? row.pointer,
    jsonPointer: extractSourceJsonPointer(row.schema),
    schema: row.schema,
  };
}

function ensureNode(
  context: BuildContext,
  pointer: string,
  force: boolean,
  options?: {
    embedded?: boolean;
    ownerNodeId?: string;
  },
): string | undefined {
  const rawSchema = getSchemaAtPointer(context.document, pointer);

  if (!rawSchema || typeof rawSchema !== 'object' || Array.isArray(rawSchema)) {
    return undefined;
  }

  const resolved = resolveReference(context.document, rawSchema, pointer);
  const effectiveSchema = resolved.schema;
  const canonicalPointer = resolved.resolvedPointer ?? pointer;
  const nodeKind = classifySchema(effectiveSchema, force, Boolean(resolved.ref));

  if (!nodeKind) {
    return undefined;
  }

  const nodeId = createNodeId(canonicalPointer, nodeKind);
  const existing = context.nodes.get(nodeId);

  if (existing) {
    return existing.id;
  }

  const node: SchemaGraphNode = {
    id: nodeId,
    kind: nodeKind,
    pointer: canonicalPointer,
    title: createNodeTitle(canonicalPointer, effectiveSchema, nodeKind),
    subtitle: createSubtitle(effectiveSchema, nodeKind),
    description: effectiveSchema.description,
    rows: [],
    metaLines: [],
    schema: effectiveSchema,
    enumValues: [],
    isEmbedded: options?.embedded ?? false,
    ownerNodeId: options?.embedded ? options.ownerNodeId ?? nodeId : nodeId,
    size: {
      width: pickWidth(nodeKind),
      height: 120,
    },
  };

  context.nodes.set(nodeId, node);
  populateNode(context, node, canonicalPointer, effectiveSchema);
  node.size = measureNode(context, node);

  return nodeId;
}

function populateNode(
  context: BuildContext,
  node: SchemaGraphNode,
  pointer: string,
  schema: JsonSchema,
): void {
  node.metaLines = createMetaLines(schema, node.kind);

  if (node.kind === 'enum') {
    node.enumValues = extractEnumValues(schema);
    return;
  }

  if (node.kind === 'object') {
    populateObjectNode(context, node, pointer, schema);
    return;
  }

  if (node.kind === 'array') {
    populateArrayNode(context, node, pointer, schema);
    return;
  }

  if (node.kind === 'combinator') {
    populateCombinatorNode(context, node, pointer, schema);
  }
}

function populateObjectNode(
  context: BuildContext,
  node: SchemaGraphNode,
  pointer: string,
  schema: JsonSchema,
): void {
  const required = new Set(schema.required ?? []);

  for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
    addChildRow(context, node, {
      label: key,
      relation: 'field',
      pointer: joinPointer(pointer, 'properties', key),
      schema: childSchema,
      required: required.has(key),
      childForce: false,
    });
  }

  for (const [pattern, childSchema] of Object.entries(schema.patternProperties ?? {})) {
    addChildRow(context, node, {
      label: `/${pattern}/`,
      relation: 'pattern',
      pointer: joinPointer(pointer, 'patternProperties', pattern),
      schema: childSchema,
      required: false,
      childForce: false,
    });
  }
}

function populateArrayNode(
  context: BuildContext,
  node: SchemaGraphNode,
  pointer: string,
  schema: JsonSchema,
): void {
  schema.prefixItems?.forEach((childSchema, index) => {
    addChildRow(context, node, {
      label: String(index),
      relation: 'index',
      pointer: joinPointer(pointer, 'prefixItems', String(index)),
      schema: childSchema,
      required: false,
      childForce: false,
    });
  });

  if (schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)) {
    addChildRow(context, node, {
      label: schema.prefixItems?.length ? 'rest' : 'items',
      relation: schema.prefixItems?.length ? 'rest' : 'items',
      pointer: joinPointer(pointer, 'items'),
      schema: schema.items,
      required: false,
      childForce: false,
      embeddedChildNode: true,
    });
  }
}

function populateCombinatorNode(
  context: BuildContext,
  node: SchemaGraphNode,
  pointer: string,
  schema: JsonSchema,
): void {
  const combinator = getCombinator(schema);

  combinator.variants.forEach((childSchema, index) => {
    addChildRow(context, node, {
      label: `${combinator.keyword} #${index + 1}`,
      relation: 'variant',
      pointer: joinPointer(pointer, combinator.keyword, String(index)),
      schema: childSchema,
      required: false,
      childForce: false,
    });
  });
}

function addChildRow(
  context: BuildContext,
  node: SchemaGraphNode,
  input: {
    label: string;
    relation: string;
    pointer: string;
    schema: JsonSchema;
    required: boolean;
    childForce: boolean;
    embeddedChildNode?: boolean;
  },
): void {
  const rowId = createRowId(node.id, input.relation, input.label);
  const childNodeId = ensureNode(context, input.pointer, input.childForce, {
    embedded: input.embeddedChildNode,
    ownerNodeId: node.ownerNodeId,
  });
  const childNode = childNodeId ? context.nodes.get(childNodeId) : undefined;
  const resolvedPointer = childNode?.pointer;
  const childIsEmbedded = Boolean(childNode?.isEmbedded);
  const childIsSelf = childNodeId === node.id;

  const row: SchemaRow = {
    id: rowId,
    label: input.label,
    typeLabel: createTypeLabel(input.schema, childNodeId !== undefined),
    pointer: input.pointer,
    resolvedPointer,
    required: input.required,
    relation: input.relation,
    description: input.schema.description,
    detailLines: createDetailLines(input.schema),
    handleId: childNodeId && !childIsEmbedded ? createSourceHandleId(rowId) : undefined,
    childNodeId,
    schema: input.schema,
  };

  node.rows.push(row);

  if (childNodeId && (!childIsEmbedded || childIsSelf)) {
    const edgeId = `e-${node.id}-${rowId}-${childNodeId}`;
    const relationLabel = getRelationLabelForChild(input.relation, childNode);

    context.edges.set(edgeId, {
      id: edgeId,
      source: node.id,
      target: childNodeId,
      sourceHandle: row.handleId,
      sourceRowId: row.id,
      label: relationLabel,
      labelPosition: 'center',
    });
  }
}

function resolveReference(
  document: JsonSchema,
  rawSchema: JsonSchema,
  pointer: string,
): ResolveResult {
  if (typeof rawSchema.$ref !== 'string') {
    return {
      schema: rawSchema,
    };
  }

  const target = resolveLocalRef(document, rawSchema.$ref);

  if (!target) {
    return {
      schema: rawSchema,
      ref: rawSchema.$ref,
      brokenRef: true,
    };
  }

  return {
    schema: {
      ...target.schema,
      ...rawSchema,
      $ref: rawSchema.$ref,
    },
    ref: rawSchema.$ref,
    resolvedPointer: target.pointer,
  };
}

function resolveLocalRef(
  document: JsonSchema,
  ref: string,
): { schema: JsonSchema; pointer: string } | null {
  if (!ref.startsWith('#')) {
    return null;
  }

  const pointer = ref === '#' ? '#' : ref;
  const schema = getSchemaAtPointer(document, pointer);

  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return null;
  }

  return {
    schema,
    pointer,
  };
}

function getSchemaAtPointer(
  document: JsonSchema,
  pointer: string,
): JsonSchema | undefined {
  if (pointer === '#') {
    return document;
  }

  if (!pointer.startsWith('#/')) {
    return undefined;
  }

  const tokens = pointer
    .slice(2)
    .split('/')
    .filter(Boolean)
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));

  let current: unknown = document;

  for (const token of tokens) {
    if (Array.isArray(current)) {
      const index = Number(token);

      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return undefined;
      }

      current = current[index];
      continue;
    }

    if (!current || typeof current !== 'object') {
      return undefined;
    }

    current = (current as Record<string, unknown>)[token];
  }

  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    return undefined;
  }

  return current as JsonSchema;
}

function classifySchema(
  schema: JsonSchema,
  force: boolean,
  fromRef: boolean,
): SchemaNodeKind | undefined {
  if (schema.enum || Object.prototype.hasOwnProperty.call(schema, 'const')) {
    return 'enum';
  }

  if (schema.anyOf || schema.oneOf || schema.allOf) {
    return 'combinator';
  }

  if (looksLikeArray(schema)) {
    return 'array';
  }

  if (looksLikeObject(schema)) {
    return 'object';
  }

  if (force || fromRef) {
    return 'ref-target';
  }

  return undefined;
}

function looksLikeObject(schema: JsonSchema): boolean {
  return (
    schema.type === 'object' ||
    (Array.isArray(schema.type) && schema.type.includes('object')) ||
    Boolean(schema.properties && Object.keys(schema.properties).length > 0) ||
    Boolean(schema.patternProperties && Object.keys(schema.patternProperties).length > 0)
  );
}

function looksLikeArray(schema: JsonSchema): boolean {
  return (
    schema.type === 'array' ||
    (Array.isArray(schema.type) && schema.type.includes('array')) ||
    'items' in schema ||
    Boolean(schema.prefixItems && schema.prefixItems.length > 0)
  );
}

function getCombinator(schema: JsonSchema): { keyword: string; variants: JsonSchema[] } {
  if (schema.anyOf) {
    return { keyword: 'anyOf', variants: schema.anyOf };
  }

  if (schema.oneOf) {
    return { keyword: 'oneOf', variants: schema.oneOf };
  }

  if (schema.allOf) {
    return { keyword: 'allOf', variants: schema.allOf };
  }

  return { keyword: 'variant', variants: [] };
}

function createTypeLabel(schema: JsonSchema, hasChildNode: boolean): string {
  let label = 'schema';

  if (schema.enum || Object.prototype.hasOwnProperty.call(schema, 'const')) {
    label = 'enum';
  } else if (schema.anyOf) {
    label = 'anyOf';
  } else if (schema.oneOf) {
    label = 'oneOf';
  } else if (schema.allOf) {
    label = 'allOf';
  } else if (schema.type) {
    label = Array.isArray(schema.type) ? schema.type.join(' | ') : schema.type;
  } else if (looksLikeObject(schema)) {
    label = 'object';
  } else if (looksLikeArray(schema)) {
    label = 'array';
  }

  if (typeof schema.format === 'string') {
    label = `${label}:${schema.format}`;
  }

  if (schema.$ref) {
    label = `${label} · ref`;
  } else if (hasChildNode && label === 'schema') {
    label = 'nested schema';
  }

  return label;
}

function createDetailLines(schema: JsonSchema): string[] {
  const lines = [...createConstraintLines(schema)];

  if (schema.$ref) {
    lines.unshift(`$ref: ${schema.$ref}`);
  }

  if (schema.description) {
    lines.unshift('description present');
  }

  return lines;
}

function createMetaLines(schema: JsonSchema, kind: SchemaNodeKind): string[] {
  const lines = createConstraintLines(schema);

  if (kind === 'object') {
    const propertyCount = Object.keys(schema.properties ?? {}).length;
    const patternCount = Object.keys(schema.patternProperties ?? {}).length;
    const fieldCount = propertyCount + patternCount;

    lines.unshift(`${fieldCount} fields`);

    if (patternCount > 0) {
      lines.unshift(`${patternCount} pattern ${patternCount === 1 ? 'rule' : 'rules'}`);
    }

    if (schema.required?.length) {
      lines.unshift(`${schema.required.length} required`);
    }
  }

  if (kind === 'array') {
    const tupleCount = schema.prefixItems?.length ?? 0;

    if (tupleCount > 0) {
      lines.unshift(`${tupleCount} tuple ${tupleCount === 1 ? 'item' : 'items'}`);
    } else if (schema.items && typeof schema.items === 'object') {
      lines.unshift('items schema present');
    } else if (schema.items === false) {
      lines.unshift('no items allowed');
    } else {
      lines.unshift('items schema missing');
    }
  }

  if (kind === 'enum') {
    lines.unshift(`${extractEnumValues(schema).length} values`);
  }

  if (kind === 'combinator') {
    lines.unshift(`${getCombinator(schema).variants.length} variants`);
  }

  return lines;
}

function createConstraintLines(schema: JsonSchema): string[] {
  const lines: string[] = [];

  if (typeof schema.minLength === 'number') {
    lines.push(`minLength: ${schema.minLength}`);
  }
  if (typeof schema.maxLength === 'number') {
    lines.push(`maxLength: ${schema.maxLength}`);
  }
  if (typeof schema.minimum === 'number') {
    lines.push(`minimum: ${schema.minimum}`);
  }
  if (typeof schema.maximum === 'number') {
    lines.push(`maximum: ${schema.maximum}`);
  }
  if (typeof schema.exclusiveMinimum === 'number') {
    lines.push(`exclusiveMinimum: ${schema.exclusiveMinimum}`);
  }
  if (typeof schema.exclusiveMaximum === 'number') {
    lines.push(`exclusiveMaximum: ${schema.exclusiveMaximum}`);
  }
  if (typeof schema.minItems === 'number') {
    lines.push(`minItems: ${schema.minItems}`);
  }
  if (typeof schema.maxItems === 'number') {
    lines.push(`maxItems: ${schema.maxItems}`);
  }
  if (typeof schema.pattern === 'string') {
    lines.push(`pattern: ${schema.pattern}`);
  }
  if (Object.prototype.hasOwnProperty.call(schema, 'const')) {
    lines.push(`const: ${previewValue(schema.const as JsonValue | undefined)}`);
  }
  if (schema.enum?.length) {
    lines.push(`enum: ${schema.enum.map(previewValue).join(', ')}`);
  }

  return lines;
}

function extractEnumValues(schema: JsonSchema): string[] {
  if (schema.enum) {
    return schema.enum.map(previewValue);
  }

  if (Object.prototype.hasOwnProperty.call(schema, 'const')) {
    return [previewValue(schema.const as JsonValue | undefined)];
  }

  return [];
}

function measureNode(
  context: BuildContext,
  node: SchemaGraphNode,
  stack = new Set<string>(),
): { width: number; height: number } {
  if (stack.has(node.id)) {
    return {
      width: pickWidth(node.kind),
      height: 0,
    };
  }

  stack.add(node.id);
  try {
    const displayNode = getPresentationNode(context.nodes, node);

    if (displayNode.kind === 'enum') {
      const width = measureEnumWidth(displayNode);

      return {
        width,
        height: ENUM_HEADER_HEIGHT + measureEnumContentHeight(displayNode),
      };
    }

    const contentHeight = measureRenderedContentHeight(context, displayNode, new Set<string>());
    let height = Math.max(124, 68 + contentHeight);

    if (
      displayNode.kind === 'array' &&
      contentHeight === 42 &&
      displayNode.rows[0]?.relation === 'items' &&
      !displayNode.rows[0]?.childNodeId
    ) {
      height = 84;
    }

    return {
      width: pickWidth(displayNode.kind),
      height,
    };
  } finally {
    stack.delete(node.id);
  }
}

function measureRenderedContentHeight(
  context: BuildContext,
  node: SchemaGraphNode,
  stack: Set<string>,
): number {
  if (stack.has(node.id)) {
    return 0;
  }

  stack.add(node.id);

  try {
    if (node.kind === 'enum') {
      return measureEnumContentHeight(node);
    }

    let total = 0;

    for (const row of node.rows) {
      const childNode = row.childNodeId ? context.nodes.get(row.childNodeId) : undefined;

      if (childNode && childNode.isEmbedded && childNode.id !== node.id && !stack.has(childNode.id)) {
        total += childNode.kind === 'enum'
          ? measureEnumContentHeight(childNode)
          : measureRenderedContentHeight(context, childNode, stack);
        continue;
      }

      total += 42;
    }

    return total;
  } finally {
    stack.delete(node.id);
  }
}

function measureEnumContentHeight(node: SchemaGraphNode): number {
  const width = measureEnumWidth(node);
  const charsPerLine = Math.max(
    10,
    Math.floor((width - ENUM_HORIZONTAL_PADDING) / ENUM_AVERAGE_CHAR_WIDTH),
  );
  const contentLines = Math.max(
    1,
    node.enumValues.reduce(
      (sum, value) => sum + Math.max(1, Math.ceil(value.length / charsPerLine)),
      0,
    ),
  );
  const pillCount = Math.max(node.enumValues.length, 1);

  return (
    ENUM_LIST_VERTICAL_PADDING +
    contentLines * ENUM_PILL_LINE_HEIGHT +
    pillCount * ENUM_PILL_VERTICAL_CHROME +
    Math.max(0, pillCount - 1) * ENUM_PILL_GAP
  );
}

function measureEnumWidth(node: SchemaGraphNode): number {
  const longestToken = Math.max(
    node.title.length,
    ...node.enumValues.map((value) => value.length),
  );

  return Math.min(ENUM_MAX_WIDTH, Math.max(ENUM_WIDTH, 110 + longestToken * 7));
}

function pickWidth(kind: SchemaNodeKind): number {
  switch (kind) {
    case 'object':
      return OBJECT_WIDTH;
    case 'array':
      return ARRAY_WIDTH;
    case 'combinator':
      return COMBINATOR_WIDTH;
    case 'enum':
      return ENUM_WIDTH;
    case 'ref-target':
      return REF_WIDTH;
  }
}

function createNodeTitle(
  pointer: string,
  schema: JsonSchema,
  kind: SchemaNodeKind,
): string {
  if (schema.title) {
    return schema.title;
  }

  if (kind === 'combinator') {
    return getCombinator(schema).keyword;
  }

  if (pointer === '#') {
    return 'Root Schema';
  }

  const tokens = parseSchemaPointer(pointer);
  const token = tokens.at(-1) ?? 'schema';

  return humanize(token);
}

function createSubtitle(schema: JsonSchema, kind: SchemaNodeKind): string {
  if (kind === 'object') {
    return 'object';
  }

  if (kind === 'array') {
    return 'array';
  }

  if (kind === 'combinator') {
    return getCombinator(schema).keyword;
  }

  if (kind === 'enum') {
    return 'enum';
  }

  if (kind === 'ref-target') {
    return 'ref target';
  }

  return createTypeLabel(schema, false);
}

function parseSchemaPointer(pointer: string): string[] {
  if (pointer === '#') {
    return [];
  }

  if (!pointer.startsWith('#/')) {
    return [pointer];
  }

  return pointer
    .slice(2)
    .split('/')
    .filter(Boolean)
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function createNodeId(pointer: string, kind: SchemaNodeKind): string {
  return `node-${kind}-${slug(pointer)}`;
}

function createRowId(nodeId: string, relation: string, label: string): string {
  return `row-${slug(nodeId)}-${slug(relation)}-${slug(label)}`;
}

function joinPointer(base: string, ...parts: string[]): string {
  const joined = parts.map((part) =>
    part.replace(/~/g, '~0').replace(/\//g, '~1'),
  );

  return base === '#'
    ? `#/${joined.join('/')}`
    : `${base}/${joined.join('/')}`;
}

function previewValue(value: JsonValue | undefined): string {
  if (typeof value === 'string') {
    return value.length > 24 ? `${value.slice(0, 21)}...` : value;
  }

  return JSON.stringify(value) ?? 'undefined';
}

function humanize(token: string): string {
  return token
    .replace(/~1/g, '/')
    .replace(/~0/g, '~')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

function collectUnsupportedWarnings(schema: JsonSchema, pointer: string, context: BuildContext): void {
  for (const key of Object.keys(schema)) {
    if (SUPPORTED_WARNINGS.has(key)) {
      context.warnings.add(`${pointer}: keyword "${key}" is shown as metadata only`);
    }
  }

  for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
    collectUnsupportedWarnings(childSchema, joinPointer(pointer, 'properties', key), context);
  }

  for (const [key, childSchema] of Object.entries(schema.patternProperties ?? {})) {
    collectUnsupportedWarnings(childSchema, joinPointer(pointer, 'patternProperties', key), context);
  }

  schema.prefixItems?.forEach((childSchema, index) => {
    collectUnsupportedWarnings(childSchema, joinPointer(pointer, 'prefixItems', String(index)), context);
  });

  if (schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)) {
    collectUnsupportedWarnings(schema.items, joinPointer(pointer, 'items'), context);
  }

  schema.anyOf?.forEach((childSchema, index) => {
    collectUnsupportedWarnings(childSchema, joinPointer(pointer, 'anyOf', String(index)), context);
  });

  schema.oneOf?.forEach((childSchema, index) => {
    collectUnsupportedWarnings(childSchema, joinPointer(pointer, 'oneOf', String(index)), context);
  });

  schema.allOf?.forEach((childSchema, index) => {
    collectUnsupportedWarnings(childSchema, joinPointer(pointer, 'allOf', String(index)), context);
  });

  for (const [key, childSchema] of Object.entries(schema.definitions ?? {})) {
    collectUnsupportedWarnings(childSchema, joinPointer(pointer, 'definitions', key), context);
  }

  for (const [key, childSchema] of Object.entries(schema.$defs ?? {})) {
    collectUnsupportedWarnings(childSchema, joinPointer(pointer, '$defs', key), context);
  }
}

function extractSourceJsonPointer(schema: JsonSchema): string {
  const trigger = pickSourceTrigger(schema);

  if (!trigger) {
    return '#';
  }

  const tokens = trigger.split('/').filter(Boolean);

  if (tokens.length === 0) {
    return '#';
  }

  if (/^\d+$/.test(tokens[0] ?? '')) {
    tokens.shift();
  }

  if (tokens.length === 0) {
    return '#';
  }

  const encoded = tokens.map((token) => token.replace(/~/g, '~0').replace(/\//g, '~1'));
  return `#/${encoded.join('/')}`;
}

function pickSourceTrigger(schema: JsonSchema): string | null {
  const rawTrigger = (schema as { j2sElementTrigger?: unknown }).j2sElementTrigger;

  if (!Array.isArray(rawTrigger)) {
    return null;
  }

  const triggers = rawTrigger.filter((item): item is string => typeof item === 'string');

  if (triggers.length === 0) {
    return null;
  }

  const preferred = triggers.find((trigger) => trigger === '0' || trigger.startsWith('0/'));
  return preferred ?? triggers[0] ?? null;
}
