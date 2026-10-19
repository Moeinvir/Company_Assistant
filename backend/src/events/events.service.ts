import { Injectable } from "@nestjs/common";
import { Observable, Subject, interval, merge } from "rxjs";
import { finalize, map } from "rxjs/operators";

/**
 * Change notifications a workspace can observe over the SSE channel. The shape
 * mirrors `BackendEvent` in the web client, which refreshes its caches when one
 * of these arrives.
 */
export type WorkspaceEvent =
  | { type: "documents.changed"; workspaceId: string; knowledgeBaseId: string }
  | { type: "knowledge.changed"; workspaceId: string }
  | { type: "assistants.changed"; workspaceId: string }
  | { type: "activity.changed"; workspaceId: string };

interface WorkspaceStream {
  subject: Subject<WorkspaceEvent>;
  subscribers: number;
}

/**
 * In-process fan-out for the per-workspace SSE channel. Streams are keyed by
 * workspace id, so a subscriber can only ever observe events of the workspace
 * it asked for; the controller still verifies membership before subscribing.
 *
 * This bus is intentionally process-local: a single API instance serves a
 * workspace, and dropping the stream when the last client leaves keeps memory
 * bounded. A multi-instance deployment would need a shared transport (for
 * example Redis pub/sub) behind the same interface.
 */
@Injectable()
export class EventsService {
  private readonly streams = new Map<string, WorkspaceStream>();

  /** Publishes an event to every client subscribed to its workspace. */
  publish(event: WorkspaceEvent) {
    this.streams.get(event.workspaceId)?.subject.next(event);
  }

  /**
   * Server-sent event frames for one workspace. Emits a JSON message frame per
   * published event, plus a plain-text keep-alive so idle connections survive
   * proxies; the client ignores frames it cannot parse as JSON.
   */
  stream(workspaceId: string): Observable<MessageEvent> {
    const stream = this.acquire(workspaceId);
    return merge(
      stream.subject.pipe(map((event) => ({ data: JSON.stringify(event) }) as MessageEvent)),
      interval(15_000).pipe(map(() => ({ data: "keep-alive" }) as MessageEvent)),
    ).pipe(finalize(() => this.release(workspaceId)));
  }

  private acquire(workspaceId: string): WorkspaceStream {
    let stream = this.streams.get(workspaceId);
    if (!stream) {
      stream = { subject: new Subject<WorkspaceEvent>(), subscribers: 0 };
      this.streams.set(workspaceId, stream);
    }
    stream.subscribers += 1;
    return stream;
  }

  private release(workspaceId: string) {
    const stream = this.streams.get(workspaceId);
    if (!stream) return;
    stream.subscribers -= 1;
    if (stream.subscribers <= 0) {
      stream.subject.complete();
      this.streams.delete(workspaceId);
    }
  }
}
