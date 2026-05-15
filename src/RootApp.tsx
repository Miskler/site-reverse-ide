import { useCallback, useEffect, useState } from 'react';
import { App as GraphEditorApp } from './App';
import { SchemaViewerPage } from './schema-viewer/SchemaViewerPage';
import {
  pushGraphRoute,
  pushSchemaRoute,
  resolveAppRoute,
  type AppRoute,
} from './lib/app-router';

export function RootApp() {
  const [route, setRoute] = useState<AppRoute>(() =>
    resolveAppRoute(window.location.pathname, window.history.state),
  );

  useEffect(() => {
    const handlePopState = () => {
      setRoute(resolveAppRoute(window.location.pathname, window.history.state));
    };

    window.addEventListener('popstate', handlePopState);

    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const openSchemaViewer = useCallback((initialSource: string | null = null) => {
    pushSchemaRoute(initialSource);
    setRoute(resolveAppRoute(window.location.pathname, window.history.state));
  }, []);

  const backToGraph = useCallback(() => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    pushGraphRoute();
    setRoute({ kind: 'graph' });
  }, []);

  if (route.kind === 'schema') {
    return (
      <SchemaViewerPage
        initialSource={route.initialSource}
        onBackToGraph={backToGraph}
      />
    );
  }

  return (
    <div className="root-app-shell">
      <button
        type="button"
        className="root-app-shell__route-switch"
        onClick={() => openSchemaViewer()}
        title="Открыть просмотр JSON Schema"
      >
        JSON Schema
      </button>
      <GraphEditorApp />
    </div>
  );
}
