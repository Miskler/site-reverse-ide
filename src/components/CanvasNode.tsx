import { Handle, Position, useViewport, type Node, type NodeProps } from '@xyflow/react';
import * as Select from '@radix-ui/react-select';
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

const TEXT_MEASURE_FONT = '400 16px "Aktsident Grotesk AG", "Manrope", "Segoe UI", sans-serif';
const NODE_MIN_WIDTH = 260;
const NODE_MAX_WIDTH = 720;
const METHOD_TRIGGER_EXTRA = 48;
const NODE_CHROME_WIDTH = 80;
const NODE_TEXT_BUFFER = 34;

let measurementContext: CanvasRenderingContext2D | null = null;

function measureTextWidth(text: string): number {
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

  measurementContext.font = TEXT_MEASURE_FONT;
  return measurementContext.measureText(text).width;
}

function MethodItem({ method }: { method: HttpMethod }) {
  return (
    <Select.Item className="graph-node__method-item" value={method} textValue={method}>
      <Select.ItemText>{method}</Select.ItemText>
      <Select.ItemIndicator className="graph-node__method-item-indicator">✓</Select.ItemIndicator>
    </Select.Item>
  );
}

function MethodSelectContent() {
  const { zoom } = useViewport();
  const selectScale = Math.max(zoom, 0.1);

  return (
    <Select.Content
      className="graph-node__method-content"
      position="popper"
      sideOffset={6 * selectScale}
      align="start"
      style={{ '--graph-zoom': `${selectScale}` } as CSSProperties}
    >
      <Select.Viewport className="graph-node__method-viewport">
        {HTTP_METHODS.map((method) => (
          <MethodItem key={method} method={method} />
        ))}
      </Select.Viewport>
    </Select.Content>
  );
}

export function CanvasNode({ id, data, selected }: NodeProps<CanvasNodeType>) {
  const [isTitleFocused, setIsTitleFocused] = useState(false);
  const [isMethodSelectOpen, setIsMethodSelectOpen] = useState(false);
  const titleText = data.title.trim();
  const title = titleText || 'Без названия';
  const titleValue = isTitleFocused ? data.title : title;
  const methodTriggerWidth = useMemo(() => {
    const widestMethodWidth = HTTP_METHODS.reduce(
      (widest, method) => Math.max(widest, measureTextWidth(method)),
      0,
    );
    return Math.ceil(widestMethodWidth + METHOD_TRIGGER_EXTRA);
  }, []);
  const nodeWidth = useMemo(() => {
    const titleWidth = measureTextWidth(titleValue);
    return Math.max(
      NODE_MIN_WIDTH,
      Math.min(
        NODE_MAX_WIDTH,
        Math.ceil(titleWidth + methodTriggerWidth + NODE_CHROME_WIDTH + NODE_TEXT_BUFFER),
      ),
    );
  }, [titleValue, methodTriggerWidth]);

  return (
    <article
      className={`graph-node${selected ? ' is-selected' : ''}`}
      style={
        {
          '--node-color': data.color,
          '--node-width': `${nodeWidth}px`,
          '--method-trigger-width': `${methodTriggerWidth}px`,
        } as CSSProperties
      }
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
        <div
          className="graph-node__method-select nodrag nopan"
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
          }}
        >
          <Select.Root
            open={isMethodSelectOpen}
            value={data.method}
            onOpenChange={setIsMethodSelectOpen}
            onValueChange={(value) => {
              data.onUpdateNode(id, { method: value as HttpMethod });
            }}
          >
            <Select.Trigger
              className="graph-node__method-trigger nodrag nopan"
              aria-label="Метод функции"
              onPointerDown={(event) => {
                if (isMethodSelectOpen && event.button === 0 && event.pointerType === 'mouse') {
                  event.preventDefault();
                  event.stopPropagation();
                  setIsMethodSelectOpen(false);
                }
              }}
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              <Select.Value />
              <Select.Icon className="graph-node__method-icon" />
            </Select.Trigger>

            <Select.Portal>
              <MethodSelectContent />
            </Select.Portal>
          </Select.Root>
        </div>

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
