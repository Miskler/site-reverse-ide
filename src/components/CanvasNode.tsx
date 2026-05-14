import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { useMemo, useState, type CSSProperties } from 'react';
import { HTTP_METHODS, type GraphNode, type HttpMethod } from '../shared/graph';

type CanvasNodePatch = Partial<Pick<GraphNode, 'method' | 'title' | 'note' | 'color'>>;

export interface CanvasNodeData extends Record<string, unknown> {
  method: HttpMethod;
  title: string;
  note: string;
  color: string;
  connectMode: boolean;
  linkCount: number;
  onRequestDelete: (nodeId: string) => void;
  onOpenEditor: (nodeId: string) => void;
  onOpenColorPicker: (nodeId: string) => void;
  onUpdateNode: (nodeId: string, patch: CanvasNodePatch) => void;
}

export type CanvasNodeType = Node<CanvasNodeData, 'canvasNode'>;

const TITLE_MEASURE_FONT = '400 16px "Aktsident Grotesk AG", "Manrope", "Segoe UI", sans-serif';
const NODE_MIN_WIDTH = 260;
const NODE_MAX_WIDTH = 720;
const NODE_CHROME_WIDTH = 172;
const NODE_TEXT_BUFFER = 48;

let measurementContext: CanvasRenderingContext2D | null = null;

function measureTitleWidth(text: string): number {
  if (typeof document === 'undefined') {
    return text.length * 10;
  }

  if (!measurementContext) {
    const canvas = document.createElement('canvas');
    measurementContext = canvas.getContext('2d');
  }

  if (!measurementContext) {
    return text.length * 10;
  }

  measurementContext.font = TITLE_MEASURE_FONT;
  return measurementContext.measureText(text).width;
}

export function CanvasNode({ id, data, selected }: NodeProps<CanvasNodeType>) {
  const [isTitleFocused, setIsTitleFocused] = useState(false);
  const titleText = data.title.trim();
  const title = titleText || 'Без названия';
  const titleValue = isTitleFocused ? data.title : title;
  const nodeWidth = useMemo(() => {
    const titleWidth = measureTitleWidth(titleValue);
    return Math.max(
      NODE_MIN_WIDTH,
      Math.min(NODE_MAX_WIDTH, Math.ceil(titleWidth + NODE_CHROME_WIDTH + NODE_TEXT_BUFFER)),
    );
  }, [titleValue]);

  return (
    <article
      className={`graph-node${selected ? ' is-selected' : ''}`}
      style={{ '--node-color': data.color, '--node-width': `${nodeWidth}px` } as CSSProperties}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        data.onOpenEditor(id);
      }}
    >
      <button
        type="button"
        className="graph-node__color-strip nodrag nopan"
        aria-label={`Изменить цвет функции ${title}`}
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
        <select
          className="graph-node__method nodrag nopan"
          aria-label="Метод функции"
          value={data.method}
          onChange={(event) => {
            data.onUpdateNode(id, { method: event.target.value as HttpMethod });
          }}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {HTTP_METHODS.map((method) => (
            <option key={method} value={method}>
              {method}
            </option>
          ))}
        </select>

        <input
          type="text"
          className="graph-node__title-input nodrag nopan"
          value={titleValue}
          aria-label={`Название функции ${title}`}
          placeholder="Название функции"
          onFocus={() => setIsTitleFocused(true)}
          onBlur={() => {
            setIsTitleFocused(false);
            data.onUpdateNode(id, { title: data.title.trim() || 'Без названия' });
          }}
          onChange={(event) => {
            data.onUpdateNode(id, { title: event.target.value });
          }}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        />

        <button
          type="button"
          className="graph-node__delete nodrag nopan"
          aria-label={`Удалить функцию ${title}`}
          title="Удалить функцию"
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
        <textarea
          className="graph-node__note-input nodrag nopan"
          value={data.note}
          aria-label={`Описание функции ${title}`}
          placeholder="Описание"
          rows={3}
          onChange={(event) => {
            data.onUpdateNode(id, { note: event.target.value });
          }}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        />
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
