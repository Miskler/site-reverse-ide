import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { ToastContainer } from 'react-toastify';
import { App as GraphEditorApp } from './App';
import { SchemaNavigationPanel } from './schema-viewer/SchemaNavigationPanel';
import { SchemaViewerPage } from './schema-viewer/SchemaViewerPage';
import { SimilarityGraphPage } from './similarity-graph/SimilarityGraphPage';
import {
  pushSchemaNodeRoute,
  pushSimilarityRoute,
  resolveAppRoute,
  type AppRoute,
} from './lib/app-router';
import { GRAPH_UPDATED_EVENT } from './lib/graph-events';
import { loadGraphDocument } from './lib/graph-store';
import type { GraphDocument } from './shared/graph';

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
  const [graphDocument, setGraphDocument] = useState<GraphDocument | null>(null);
  const [graphBusy, setGraphBusy] = useState(true);
  const [graphLoadError, setGraphLoadError] = useState<string | null>(null);
  const rootShellStyle: CSSProperties = {
    '--root-nav-width': 'calc(320px / 1.5)',
  } as CSSProperties;

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

  const navigateSchemaNode = useCallback((nodeUid: string, jsonIndex: number | null = null) => {
    pushSchemaNodeRoute(nodeUid, jsonIndex);
    setRoute(resolveAppRoute(window.location.pathname, window.history.state));
  }, []);

  const goToSimilarity = useCallback(() => {
    pushSimilarityRoute();
    setRoute(resolveAppRoute(window.location.pathname, window.history.state));
  }, []);

  const backToGraph = useCallback(() => {
    setRoute({ kind: 'graph' });
    window.history.pushState(null, '', '/');
  }, []);

  const loadSidebarGraph = useCallback(async () => {
    setGraphBusy(true);

    try {
      const graph = await loadGraphDocument();
      setGraphDocument(graph);
      setGraphLoadError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load graph navigation.';
      setGraphDocument(null);
      setGraphLoadError(message);
    } finally {
      setGraphBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadSidebarGraph();

    const handleGraphUpdate = () => {
      void loadSidebarGraph();
    };

    window.addEventListener(GRAPH_UPDATED_EVENT, handleGraphUpdate);
    window.addEventListener('storage', handleGraphUpdate);

    return () => {
      window.removeEventListener(GRAPH_UPDATED_EVENT, handleGraphUpdate);
      window.removeEventListener('storage', handleGraphUpdate);
    };
  }, [loadSidebarGraph]);

  return (
    <>
      <ToastContainer {...TOAST_CONTAINER_OPTIONS} />
      <div className="root-app-shell" style={rootShellStyle}>
        <SchemaNavigationPanel
          graph={graphDocument}
          busy={graphBusy}
          loadError={graphLoadError}
          currentNodeUid={route.kind === 'schema' ? route.nodeUid : ''}
          routeKind={route.kind}
          onGoToGraph={backToGraph}
          onGoToSimilarity={goToSimilarity}
          onOpenSchemaNode={navigateSchemaNode}
        />

        <div className="root-app-shell__content">
          {route.kind === 'schema' ? (
            <SchemaViewerPage
              nodeUid={route.nodeUid}
              jsonIndex={route.jsonIndex}
            />
          ) : route.kind === 'similarity' ? (
          <SimilarityGraphPage
              graph={graphDocument}
              busy={graphBusy}
              loadError={graphLoadError}
              onNavigateSchemaNode={navigateSchemaNode}
            />
          ) : (
            <GraphEditorApp />
          )}
        </div>
      </div>
    </>
  );
}
