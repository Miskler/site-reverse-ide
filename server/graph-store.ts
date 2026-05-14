import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import writeFileAtomic from 'write-file-atomic';
import { createDefaultGraph, type GraphDocument } from '../src/shared/graph';
import { GraphValidationError, parseGraphDocument } from './graph-schema';

export class GraphStore {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<GraphDocument> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      return parseGraphDocument(JSON.parse(raw) as unknown);
    } catch (error) {
      if (error instanceof GraphValidationError) {
        return createDefaultGraph();
      }

      return createDefaultGraph();
    }
  }

  async save(payload: unknown): Promise<GraphDocument> {
    const graph = parseGraphDocument(payload);
    await mkdir(path.dirname(this.filePath), { recursive: true });

    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(() =>
        writeFileAtomic(this.filePath, `${JSON.stringify(graph, null, 2)}\n`, {
          encoding: 'utf8',
        }),
      );

    await this.writeQueue;
    return graph;
  }
}
