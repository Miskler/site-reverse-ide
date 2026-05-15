import { useCallback, useEffect, useState } from 'react';
import { ToastContainer } from 'react-toastify';
import { App as GraphEditorApp } from './App';
import { SchemaViewerPage } from './schema-viewer/SchemaViewerPage';
import {
  pushGraphRoute,
  pushSchemaRoute,
  resolveAppRoute,
  type AppRoute,
} from './lib/app-router';

const TOAST_CONTAINER_OPTIONS = {
  position: 'bottom-right' as const,
  autoClose: 4500,
  closeButton: true,
  closeOnClick: false,
  draggable: 'touch' as const,
  hideProgressBar: false,
  icon: false as const,
  limit: 3,
  pauseOnHover: true,
  pauseOnFocusLoss: true,
  theme: 'dark' as const,
  toastClassName: 'app-toast',
  progressClassName: 'app-toast__progress',
};

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

  return (
    <>
      <ToastContainer {...TOAST_CONTAINER_OPTIONS} />
      {route.kind === 'schema' ? (
        <SchemaViewerPage
          initialSource={route.initialSource}
          onBackToGraph={backToGraph}
        />
      ) : (
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
      )}
    </>
  );
}
