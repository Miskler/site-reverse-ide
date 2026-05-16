import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { ReactNode } from 'react';
import { createTargetHandleId } from './handle-ids';
import { getPresentationNode } from './node-presentation';
import type { FlowNodeData } from './flow-types';
import type { SchemaGraphNode, SchemaRow } from './schema-types';

export type SchemaNodeType = Node<FlowNodeData, 'schema'>;

export function SchemaNode({ data, id, selected }: NodeProps<SchemaNodeType>) {
  const { schemaNode, selection, nodeMap } = data;
  const displayNode = getPresentationNode(nodeMap, schemaNode);
  const activeRowId =
    selection?.kind === 'row' && selection.nodeId === displayNode.id ? selection.rowId : null;
  const nodeSelected =
    selected ||
    (selection?.kind === 'node' &&
      (selection.nodeId === schemaNode.id || selection.nodeId === displayNode.id));
  const hasRequiredRows = displayNode.rows.some((row) => row.required);
  const isRootNode = schemaNode.pointer === '#';

  return (
    <article
      className={[
        'schema-node',
        `schema-node--${displayNode.kind}`,
        nodeSelected ? 'is-selected' : '',
        activeRowId ? 'has-selected-row' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-node-id={id}
      onClick={(event) => {
        event.stopPropagation();
        data.onSelectNode(displayNode.id);
      }}
    >
      {!isRootNode ? (
        <Handle
          id={createTargetHandleId(id)}
          type="target"
          position={Position.Left}
          className="schema-node__target"
        />
      ) : null}

      <div className="schema-node__header">
        <div>
          <div className="schema-node__title">{schemaNode.title}</div>
          <div className="schema-node__subtitle">{displayNode.subtitle}</div>
        </div>
        <span className="schema-node__badge">{displayNode.kind}</span>
      </div>

      {displayNode.kind === 'enum' ? (
        <div className="schema-node__enum-list">
          {displayNode.enumValues.map((value) => (
            <span className="schema-node__enum-pill" key={value}>
              {value}
            </span>
          ))}
        </div>
      ) : (
        <div className="schema-node__rows">
          {renderFlatRows({
            schemaNode: displayNode,
            data,
            inlineStack: Array.from(new Set([schemaNode.id, displayNode.id])),
            path: [schemaNode.id, displayNode.id],
            activeRowId,
            hasRequiredRows,
          })}
        </div>
      )}
    </article>
  );
}

function renderFlatRows({
  schemaNode,
  data,
  inlineStack,
  activeRowId,
  hasRequiredRows,
  path,
}: {
  schemaNode: SchemaGraphNode;
  data: FlowNodeData;
  inlineStack: string[];
  path: string[];
  activeRowId: string | null;
  hasRequiredRows: boolean;
}): ReactNode[] {
  const { nodeMap, selection, onSelectRow } = data;
  const renderedRows: ReactNode[] = [];

  for (const row of schemaNode.rows) {
    const childNode = getEmbeddedChild(nodeMap, schemaNode, row, inlineStack);
    const rowKey = `${path.join('>')}:${row.id}`;

    if (childNode) {
      if (childNode.kind === 'enum') {
        renderedRows.push(renderInlineEnumList(childNode, `${rowKey}:enum`));
        continue;
      }

      renderedRows.push(
        ...renderFlatRows({
          schemaNode: childNode,
          data,
          inlineStack: [...inlineStack, childNode.id],
          path: [...path, row.id, childNode.id],
          activeRowId:
            selection?.kind === 'row' && selection.nodeId === childNode.id ? selection.rowId : null,
          hasRequiredRows: childNode.rows.some((childRow) => childRow.required),
        }),
      );
      continue;
    }

    const rowSelected = activeRowId === row.id;
    const isRecursiveReference = Boolean(
      row.childNodeId && childNode === null && isCycleReference(row, schemaNode, inlineStack),
    );

    renderedRows.push(
      <button
        type="button"
        data-row-id={row.id}
        className={[
          'schema-node__row',
          rowSelected ? 'is-active' : '',
          isRecursiveReference ? 'is-recursive' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        key={rowKey}
        onClick={(event) => {
          event.stopPropagation();
          onSelectRow(schemaNode.id, row.id);
        }}
      >
        {hasRequiredRows ? <span className="schema-node__required">{row.required ? '!' : ''}</span> : null}
        <span className="schema-node__label">{row.label}</span>
        <span className="schema-node__type">
          {row.typeLabel}
          {isRecursiveReference ? ' self' : ''}
        </span>

        {row.handleId ? (
          <Handle
            id={row.handleId}
            type="source"
            position={Position.Right}
            className="schema-node__source"
          />
        ) : null}
      </button>,
    );
  }

  return renderedRows;
}

function renderInlineEnumList(schemaNode: SchemaGraphNode, key: string) {
  return (
    <div className="schema-node__enum-list" key={key}>
      {schemaNode.enumValues.map((value) => (
        <span className="schema-node__enum-pill" key={value}>
          {value}
        </span>
      ))}
    </div>
  );
}

function getEmbeddedChild(
  nodeMap: Record<string, SchemaGraphNode>,
  schemaNode: SchemaGraphNode,
  row: SchemaRow,
  inlineStack: string[],
): SchemaGraphNode | null {
  if (!row.childNodeId) {
    return null;
  }

  const childNode = nodeMap[row.childNodeId];

  if (!childNode || !childNode.isEmbedded) {
    return null;
  }

  if (childNode.id === schemaNode.id || inlineStack.includes(childNode.id)) {
    return null;
  }

  return childNode;
}

function isCycleReference(
  row: SchemaRow,
  schemaNode: SchemaGraphNode,
  inlineStack: string[],
): boolean {
  return Boolean(
    row.childNodeId &&
      (row.childNodeId === schemaNode.id || inlineStack.includes(row.childNodeId)),
  );
}
