import { useCallback, useEffect, useState } from 'react';
import { ToastContainer } from 'react-toastify';
import { App as GraphEditorApp } from './App';
import { SchemaViewerPage } from './schema-viewer/SchemaViewerPage';
import {
  pushGraphRoute,
  pushSchemaNodeRoute,
  resolveAppRoute,
  type AppRoute,
} from './lib/app-router';
import { STORAGE_KEY, createDefaultGraph, sanitizeGraphDocument } from './shared/graph';

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

  useEffect(() => {
    if (route.kind !== 'graph' || window.location.pathname === '/') {
      return;
    }

    window.history.replaceState(null, '', '/');
  }, [route]);

  const openSchemaViewer = useCallback(() => {
    const nodeUid = resolveFirstGraphNodeUid();
    pushSchemaNodeRoute(nodeUid);
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
          nodeUid={route.nodeUid}
          jsonIndex={route.jsonIndex}
          onBackToGraph={backToGraph}
        />
      ) : (
        <div className="root-app-shell">
          <button
            type="button"
            className="root-app-shell__route-switch"
            onClick={() => openSchemaViewer()}
            title="Open schema viewer"
          >
            JSON Schema
          </button>
          <GraphEditorApp />
        </div>
      )}
    </>
  );
}

function resolveFirstGraphNodeUid(): string {
  const fallback = createDefaultGraph().nodes[0]?.uid ?? 'NODE';

  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return fallback;
    }

    const graph = sanitizeGraphDocument(JSON.parse(raw) as unknown);
    return graph.nodes[0]?.uid ?? fallback;
  } catch {
    return fallback;
  }
}
