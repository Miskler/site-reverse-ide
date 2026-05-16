import type { ReactNode } from 'react';

interface InspectorShellProps {
  eyebrow: string;
  title: string;
  badge?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  children: ReactNode;
}

export function InspectorShell({
  eyebrow,
  title,
  badge,
  actionLabel = 'Close',
  onAction,
  children,
}: InspectorShellProps) {
  return (
    <aside className="schema-viewer__panel schema-viewer__panel--details">
      <div className="schema-viewer__detail-header">
        <div>
          <div className="schema-viewer__eyebrow">{eyebrow}</div>
          <div className="schema-viewer__detail-title-row">
            <h2 className="schema-viewer__title schema-viewer__title--compact">{title}</h2>
            {badge ? <span className="schema-viewer__badge">{badge}</span> : null}
          </div>
        </div>
        {onAction ? (
          <button type="button" onClick={onAction}>
            {actionLabel}
          </button>
        ) : null}
      </div>

      {children}
    </aside>
  );
}
