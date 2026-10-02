// ---------------------------------------------------------------------------
// Upload queue with per-file status and *real* progress (marina portal).
//
// Two rules from the brief drive the design:
//
//  §8  "Do not pretend to show progress if the backend does not provide real
//      progress." — the percentage comes from `XMLHttpRequest.upload.onprogress`
//      (see `uploadWithProgress` in api.ts), i.e. bytes actually handed to the
//      socket. Once those bytes are sent the server is still working (Cloudinary
//      transcode, thumbnailing, virus scan) for an unknown length of time, so
//      the item moves to an explicitly indeterminate `processing` state rather
//      than sitting at a dishonest 99%.
//
//  §9  Per-file status, never one aggregate bar. Four files means four rows,
//      each with its own state and its own Retry, so a single failure is
//      identifiable and recoverable without redoing the other three.
// ---------------------------------------------------------------------------
import React from 'react';
import { errorMessage } from './errors';

export type UploadStatus =
  /** Queued behind the concurrency limit. */
  | 'waiting'
  /** Bytes in flight — `progress` is meaningful. */
  | 'uploading'
  /** All bytes sent; the server is working. Duration unknown, so no percentage. */
  | 'processing'
  | 'done'
  | 'error'
  | 'cancelled';

export interface UploadItem<TMeta = unknown> {
  id: string;
  /** File name shown to the user. */
  name: string;
  file: File;
  status: UploadStatus;
  /** 0–100, measured. Only meaningful while `status === 'uploading'`. */
  progress: number;
  /** Human-readable failure reason, safe to display. */
  error?: string;
  /** Whatever the caller needs to carry through (docType, category, index…). */
  meta?: TMeta;
}

/** Does the caller's actual HTTP call, reporting measured progress as it goes. */
export type Uploader<TMeta> = (
  item: UploadItem<TMeta>,
  onProgress: (pct: number) => void
) => Promise<unknown>;

export interface UploadQueueOptions<TMeta> {
  uploader: Uploader<TMeta>;
  /**
   * Parallel uploads. Keep this at 1 for endpoints that *append* to an array
   * (marina images, slot images): two overlapping requests can read-modify-write
   * the same document and silently drop one of the two files.
   */
  concurrency?: number;
  onItemDone?: (item: UploadItem<TMeta>, result: unknown) => void;
  /** Fired when the queue drains, with the final tallies (§25). */
  onAllSettled?: (summary: UploadSummary) => void;
}

export interface UploadSummary {
  total: number;
  done: number;
  failed: number;
  /** Still waiting/uploading/processing. */
  pending: number;
  /** 0–100 across the whole batch, weighted per file. */
  overallProgress: number;
  isUploading: boolean;
}

let uid = 0;

export function useUploadQueue<TMeta = unknown>(options: UploadQueueOptions<TMeta>) {
  const { concurrency = 2 } = options;
  const [items, setItems] = React.useState<UploadItem<TMeta>[]>([]);

  const optsRef = React.useRef(options);
  optsRef.current = options;
  const mounted = React.useRef(true);
  /** Ids currently in flight — the concurrency gate. */
  const running = React.useRef<Set<string>>(new Set());
  /** Latest items, readable synchronously by the pump. */
  const itemsRef = React.useRef<UploadItem<TMeta>[]>([]);
  itemsRef.current = items;

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const patch = React.useCallback((id: string, next: Partial<UploadItem<TMeta>>) => {
    if (!mounted.current) return;
    setItems((cur) => cur.map((it) => (it.id === id ? { ...it, ...next } : it)));
  }, []);

  const pumpRef = React.useRef<() => void>(() => {});

  const startOne = React.useCallback(
    async (item: UploadItem<TMeta>) => {
      running.current.add(item.id);
      patch(item.id, { status: 'uploading', progress: 0, error: undefined });

      try {
        const result = await optsRef.current.uploader(item, (pct) => {
          if (pct >= 100) {
            // Bytes are gone; from here the wait is server-side and of unknown
            // length. Say so rather than parking at 100% for eight seconds.
            patch(item.id, { status: 'processing', progress: 100 });
          } else {
            patch(item.id, { status: 'uploading', progress: pct });
          }
        });
        patch(item.id, { status: 'done', progress: 100 });
        optsRef.current.onItemDone?.({ ...item, status: 'done', progress: 100 }, result);
      } catch (err) {
        patch(item.id, { status: 'error', error: errorMessage(err) });
      } finally {
        running.current.delete(item.id);
        // Drain the rest. Deferred a tick so the state patch above lands first.
        setTimeout(() => pumpRef.current(), 0);
      }
    },
    [patch]
  );

  const pump = React.useCallback(() => {
    if (!mounted.current) return;
    const free = concurrency - running.current.size;
    if (free <= 0) return;

    const next = itemsRef.current
      .filter((it) => it.status === 'waiting' && !running.current.has(it.id))
      .slice(0, free);

    next.forEach((it) => void startOne(it));

    if (!next.length && running.current.size === 0) {
      const s = summarize(itemsRef.current);
      if (s.total > 0 && s.pending === 0) optsRef.current.onAllSettled?.(s);
    }
  }, [concurrency, startOne]);
  pumpRef.current = pump;

  /** Add files and begin. Returns the ids so a caller can track specific files. */
  const enqueue = React.useCallback(
    (files: File[], meta?: TMeta) => {
      const created: UploadItem<TMeta>[] = files.map((f) => ({
        id: `u${++uid}`,
        name: f.name,
        file: f,
        meta,
        status: 'waiting',
        progress: 0,
      }));
      setItems((cur) => {
        const merged = [...cur, ...created];
        itemsRef.current = merged;
        return merged;
      });
      setTimeout(() => pumpRef.current(), 0);
      return created.map((c) => c.id);
    },
    []
  );

  /** Re-queue one failed file (§9/§33 — the per-row Retry). */
  const retry = React.useCallback((id: string) => {
    setItems((cur) => {
      const merged = cur.map((it) =>
        it.id === id && (it.status === 'error' || it.status === 'cancelled')
          ? { ...it, status: 'waiting' as UploadStatus, progress: 0, error: undefined }
          : it
      );
      itemsRef.current = merged;
      return merged;
    });
    setTimeout(() => pumpRef.current(), 0);
  }, []);

  const retryAllFailed = React.useCallback(() => {
    setItems((cur) => {
      const merged = cur.map((it) =>
        it.status === 'error' ? { ...it, status: 'waiting' as UploadStatus, progress: 0, error: undefined } : it
      );
      itemsRef.current = merged;
      return merged;
    });
    setTimeout(() => pumpRef.current(), 0);
  }, []);

  /** Drop a row. In-flight items are left alone — removing mid-PUT is a lie. */
  const remove = React.useCallback((id: string) => {
    setItems((cur) => {
      const merged = cur.filter((it) => it.id !== id || it.status === 'uploading' || it.status === 'processing');
      itemsRef.current = merged;
      return merged;
    });
  }, []);

  const clearSettled = React.useCallback(() => {
    setItems((cur) => {
      const merged = cur.filter((it) => it.status !== 'done');
      itemsRef.current = merged;
      return merged;
    });
  }, []);

  const summary = React.useMemo(() => summarize(items), [items]);

  return { items, summary, enqueue, retry, retryAllFailed, remove, clearSettled };
}

function summarize<TMeta>(items: UploadItem<TMeta>[]): UploadSummary {
  const total = items.length;
  const done = items.filter((i) => i.status === 'done').length;
  const failed = items.filter((i) => i.status === 'error').length;
  const pending = items.filter(
    (i) => i.status === 'waiting' || i.status === 'uploading' || i.status === 'processing'
  ).length;

  // Weighted so a two-file batch at 50%/0% reads 25%, not "1 of 2".
  const overallProgress =
    total === 0
      ? 0
      : Math.round(
          items.reduce((sum, i) => sum + (i.status === 'done' ? 100 : i.status === 'error' ? 0 : i.progress), 0) / total
        );

  return { total, done, failed, pending, overallProgress, isUploading: pending > 0 };
}
