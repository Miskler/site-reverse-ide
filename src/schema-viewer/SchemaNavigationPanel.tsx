import { useEffect, useRef, useState } from 'react';
import type { GraphDocument } from '../shared/graph';

interface SchemaNavigationPanelProps {
  graph: GraphDocument | null;
  busy: boolean;
  loadError: string | null;
  currentNodeUid: string;
  routeKind: 'graph' | 'schema';
  onGoToGraph: () => void;
  onOpenSchemaNode: (nodeUid: string, jsonIndex?: number | null) => void;
}

export function SchemaNavigationPanel({
  graph,
  busy,
  loadError,
  currentNodeUid,
  routeKind,
  onGoToGraph,
  onOpenSchemaNode,
}: SchemaNavigationPanelProps) {
  const nodes = graph?.nodes ?? [];
  const [isSchemaMenuOpen, setSchemaMenuOpen] = useState(() => routeKind === 'schema');
  const [schemaArrowTurns, setSchemaArrowTurns] = useState(() => (routeKind === 'schema' ? 180 : 0));
  const previousSchemaMenuOpen = useRef(isSchemaMenuOpen);

  useEffect(() => {
    setSchemaMenuOpen(routeKind === 'schema');
  }, [routeKind]);

  useEffect(() => {
    if (previousSchemaMenuOpen.current === isSchemaMenuOpen) {
      return;
    }

    previousSchemaMenuOpen.current = isSchemaMenuOpen;
    setSchemaArrowTurns((currentTurns) => currentTurns + 180);
  }, [isSchemaMenuOpen]);

  const isSchemaActive = routeKind === 'schema' || isSchemaMenuOpen;
  const handleToggleSchemaMenu = () => {
    setSchemaMenuOpen((value) => !value);
  };

  return (
    <div className="schema-viewer__global-nav">
      <div className="schema-viewer__nav-header">
        <span className="schema-viewer__label">Навигация</span>
      </div>

      <div className="schema-viewer__nav-rail">
        <button
          type="button"
          className={`schema-viewer__nav-switch${routeKind === 'graph' ? ' is-active' : ''}`}
          aria-pressed={routeKind === 'graph'}
          onClick={onGoToGraph}
        >
          <span className="schema-viewer__nav-switch-title">Ноды</span>
          <span className="schema-viewer__nav-switch-caption">Основной canvas</span>
        </button>
        <button
          type="button"
          className={`schema-viewer__nav-switch${isSchemaActive ? ' is-active' : ''}`}
          aria-pressed={isSchemaActive}
          aria-expanded={isSchemaMenuOpen}
          onClick={handleToggleSchemaMenu}
        >
          <span className="schema-viewer__nav-switch-main">
            <span className="schema-viewer__nav-switch-title">Схемы</span>
          </span>
          <span className="schema-viewer__nav-switch-arrow" aria-hidden="true">
            <svg
              style={{ transform: `translateZ(0) rotate(${schemaArrowTurns}deg)` }}
              viewBox="0 0 24 24"
              className="schema-viewer__nav-switch-arrow-icon"
            >
              <path d="M6 12h12" />
              <path d="M13 6l6 6-6 6" />
            </svg>
          </span>
          <span className="schema-viewer__nav-switch-caption">Просмотр схем нод</span>
        </button>
      </div>

      {isSchemaMenuOpen ? (
        <aside className="schema-viewer__nav-popup">
          <div className="schema-viewer__nav-content">
            <div className="schema-viewer__section-head schema-viewer__nav-content-head">
              <span className="schema-viewer__label">Схемы</span>
              <span className="schema-viewer__nav-count">{nodes.length}</span>
            </div>

            {busy && nodes.length === 0 ? (
              <p className="schema-viewer__nav-state">Загружаю список схем...</p>
            ) : loadError && nodes.length === 0 ? (
              <p className="schema-viewer__nav-state schema-viewer__nav-state--error">{loadError}</p>
            ) : nodes.length === 0 ? (
              <p className="schema-viewer__nav-state">Ноды со схемами не найдены.</p>
            ) : (
              <div className="schema-viewer__nav-list">
                {nodes.map((node) => {
                  const isActive = node.uid === currentNodeUid;
                  const hasSources = node.rawJsons.length > 0;

                  return (
                    <section
                      key={node.uid}
                      className={`schema-viewer__nav-node${isActive ? ' is-active' : ''}`}
                    >
                      <button
                        type="button"
                        className="schema-viewer__nav-node-main"
                        onClick={() => onOpenSchemaNode(node.uid, null)}
                        title={`Open schema for ${node.title}`}
                      >
                        <span className="schema-viewer__nav-node-title">
                          {node.title}
                          <span className="schema-viewer__nav-node-uid">({node.uid})</span>
                        </span>
                        <span className="schema-viewer__nav-node-method">{node.method}</span>
                      </button>

                      <div className="schema-viewer__nav-source-list">
                        {!hasSources ? (
                          <div className="schema-viewer__nav-empty-sources">(нет json&apos;s)</div>
                        ) : (
                          node.rawJsons.map((rawJson, index) => (
                            <button
                              key={`${node.uid}-${index}`}
                              type="button"
                              className="schema-viewer__nav-source"
                              onClick={() => onOpenSchemaNode(node.uid, index)}
                              title={`Open JSON ${index + 1} for ${node.title}`}
                            >
                              <span className="schema-viewer__nav-source-title">
                                {formatVariantLabel(index)}
                              </span>
                              <span className="schema-viewer__nav-source-size">
                                {formatSourceSize(rawJson)}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
      ) : null}
    </div>
  );
}

function formatVariantLabel(index: number): string {
  switch (index) {
    case 0:
      return 'первый вариант';
    case 1:
      return 'второй вариант';
    case 2:
      return 'третий вариант';
    default:
      return `вариант ${index + 1}`;
  }
}

function formatSourceSize(rawJson: string): string {
  const bytes =
    typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(rawJson).length : rawJson.length;
  const kb = bytes / 1024;

  if (kb < 1024) {
    return `${Math.max(1, Math.round(kb))} кб`;
  }

  return `${Math.max(1, Math.round(kb / 1024))} мб`;
}
