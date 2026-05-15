import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { createTargetHandleId } from './handle-ids';
import type { FlowNodeData } from './flow-types';

export type SchemaNodeType = Node<FlowNodeData, 'schema'>;

export function SchemaNode({ data, id, selected }: NodeProps<SchemaNodeType>) {
  const { schemaNode, selection, onSelectNode, onSelectRow, isSelectedNode, isSelectedRow } = data;
  const activeRowId = selection?.kind === 'row' ? selection.rowId : null;
  const nodeSelected = selected || isSelectedNode;
  const hasRequiredRows = schemaNode.rows.some((row) => row.required);
  const isRootNode = schemaNode.pointer === '#';

  return (
    <article
      className={[
        'schema-node',
        `schema-node--${schemaNode.kind}`,
        nodeSelected ? 'is-selected' : '',
        isSelectedRow ? 'has-selected-row' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-node-id={id}
      onClick={() => onSelectNode(id)}
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
          <div className="schema-node__subtitle">{schemaNode.subtitle}</div>
        </div>
        <span className="schema-node__badge">{schemaNode.kind}</span>
      </div>

      {schemaNode.kind === 'enum' ? (
        <div className="schema-node__enum-list">
          {schemaNode.enumValues.map((value) => (
            <span className="schema-node__enum-pill" key={value}>
              {value}
            </span>
          ))}
        </div>
      ) : (
        <div className="schema-node__rows">
          {schemaNode.rows.map((row) => {
            const rowSelected = activeRowId === row.id;

            return (
              <button
                type="button"
                key={row.id}
                data-row-id={row.id}
                className={[
                  'schema-node__row',
                  rowSelected ? 'is-active' : '',
                  row.childNodeId ? 'has-child' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectRow(id, row.id);
                }}
              >
                {hasRequiredRows ? (
                  <span className="schema-node__required">
                    {row.required ? '!' : ''}
                  </span>
                ) : null}
                <span className="schema-node__label">{row.label}</span>
                <span className="schema-node__type">{row.typeLabel}</span>

                {row.handleId ? (
                  <Handle
                    id={row.handleId}
                    type="source"
                    position={Position.Right}
                    className="schema-node__source"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </article>
  );
}
