import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';

export interface CanvasNodeData extends Record<string, unknown> {
  title: string;
  note: string;
  color: string;
  connectMode: boolean;
  linkCount: number;
  onDelete: (nodeId: string) => void;
}

export type CanvasNodeType = Node<CanvasNodeData, 'canvasNode'>;

export function CanvasNode({ id, data, selected }: NodeProps<CanvasNodeType>) {
  const title = data.title.trim() || 'Без названия';
  const note = data.note.trim() || 'Добавь краткое описание блока.';

  return (
    <article
      className={`graph-node${selected ? ' is-selected' : ''}`}
      style={{ '--node-color': data.color } as CSSProperties}
    >
      <Handle
        type="target"
        id="target"
        position={Position.Left}
        className={`graph-node__handle${data.connectMode ? ' is-visible' : ''}`}
        isConnectable={data.connectMode}
      />
      <div className="graph-node__chrome">
        <span className="graph-node__tag">Блок</span>
        <button
          type="button"
          className="graph-node__delete"
          aria-label={`Удалить блок ${title}`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            data.onDelete(id);
          }}
        >
          ×
        </button>
      </div>
      <div className="graph-node__body">
        <h3>{title}</h3>
        <p>{note}</p>
      </div>
      <footer className="graph-node__footer">
        <span>{data.connectMode ? 'Тяни за маркер для связи' : 'Перетащи для движения'}</span>
        <span>{data.linkCount} связ.</span>
      </footer>
      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className={`graph-node__handle${data.connectMode ? ' is-visible' : ''}`}
        isConnectable={data.connectMode}
      />
    </article>
  );
}
