import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';

export interface CanvasNodeData extends Record<string, unknown> {
  title: string;
  note: string;
  color: string;
  connectMode: boolean;
  linkCount: number;
  onRequestDelete: (nodeId: string) => void;
  onOpenEditor: (nodeId: string) => void;
  onOpenColorPicker: (nodeId: string) => void;
}

export type CanvasNodeType = Node<CanvasNodeData, 'canvasNode'>;

export function CanvasNode({ id, data, selected }: NodeProps<CanvasNodeType>) {
  const title = data.title.trim() || 'Без названия';
  const note = data.note.trim() || 'Добавь краткое описание элемента.';

  return (
    <article
      className={`graph-node${selected ? ' is-selected' : ''}`}
      style={{ '--node-color': data.color } as CSSProperties}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        data.onOpenEditor(id);
      }}
    >
      <button
        type="button"
        className="graph-node__color-strip nodrag nopan"
        aria-label={`Изменить цвет элемента ${title}`}
        title="Изменить цвет"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          data.onOpenColorPicker(id);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      />

      <Handle
        type="target"
        id="target"
        position={Position.Left}
        className={`graph-node__handle${data.connectMode ? ' is-visible' : ''}`}
        isConnectable={data.connectMode}
      />

      <div className="graph-node__chrome">
        <button
          type="button"
          className="graph-node__delete nodrag nopan"
          aria-label={`Удалить элемент ${title}`}
          title="Удалить элемент"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            data.onRequestDelete(id);
          }}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          ×
        </button>
      </div>

      <div className="graph-node__body">
        <h3>{title}</h3>
        <p>{note}</p>
      </div>

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
