import { createHash } from 'node:crypto';
import { z } from 'zod';
import { MessageError, type Message } from '../../../frontend/src/domain/messages';
import { StudioClient, StudioHttpError } from '../client';

import messages from '../../../frontend/src/i18n/resources/en.json';

export type McpContentBlock = { type: 'text'; text: string } | { type: 'audio'; data: string; mimeType: string };
export type McpToolPayload = { __mcpContent: true; content: McpContentBlock[] };
export function contentPayload(content: McpContentBlock[]): McpToolPayload { return { __mcpContent: true, content }; }
export class OperationError extends Error {
  constructor(readonly cause: unknown, readonly context: Record<string, unknown>) { super(cause instanceof Error ? cause.message : String(cause)); }
}
export function withOperationContext<T>(operation: Record<string, unknown>, index: number, revision: string, run: () => T): T {
  try { return run(); } catch (error) {
    throw new OperationError(error, { operation_index: index, ...operation, current_revision: revision, hint: 'Read the affected objects at the current revision, correct this operation, then retry the entire batch.' });
  }
}

const MAX_IDEMPOTENCY_ENTRIES = 1024;

export type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type ToolIdempotencyContext = {
  checkpoint?: unknown;
  saveCheckpoint: (checkpoint: unknown) => void;
};

export type ToolContext = {
  client: StudioClient;
  idempotency?: ToolIdempotencyContext;
};

type IdempotencyEntry =
  | { status: 'in_flight'; digest: string; promise: Promise<unknown> }
  | { status: 'partial'; digest: string; checkpoint: unknown }
  | { status: 'succeeded'; digest: string; result: unknown };

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) out[key] = stableValue(entry);
    }
    return out;
  }
  return value;
}

function requestDigest(name: string, args: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stableValue({ tool: name, args })))
    .digest('hex');
}

export type ToolDefinition<TSchema extends z.ZodRawShape = z.ZodRawShape, TResult = unknown> = {
  name: string;
  title?: string;
  description: string;
  inputSchema: TSchema;
  annotations?: ToolAnnotations;
  execute: (args: z.infer<z.ZodObject<TSchema>>, ctx: ToolContext) => Promise<TResult>;
};

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition<z.ZodRawShape, unknown>>();
  private readonly idempotency = new Map<string, IdempotencyEntry>();

  private setIdempotencyEntry(key: string, entry: IdempotencyEntry): void {
    if (this.idempotency.has(key)) {
      this.idempotency.delete(key);
    } else if (this.idempotency.size >= MAX_IDEMPOTENCY_ENTRIES) {
      for (const oldestKey of this.idempotency.keys()) {
        if (this.idempotency.get(oldestKey)?.status !== 'in_flight') {
          this.idempotency.delete(oldestKey);
          break;
        }
      }
      if (this.idempotency.size >= MAX_IDEMPOTENCY_ENTRIES) {
        const oldestKey = this.idempotency.keys().next().value;
        if (oldestKey !== undefined) this.idempotency.delete(oldestKey);
      }
    }
    this.idempotency.set(key, entry);
  }

  register<TSchema extends z.ZodRawShape, TResult>(tool: ToolDefinition<TSchema, TResult>): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Duplicate tool registration: ${tool.name}`);
    }
    this.tools.set(tool.name, tool as unknown as ToolDefinition<z.ZodRawShape, unknown>);
    return this;
  }

  list(): ToolDefinition<z.ZodRawShape, unknown>[] {
    return Array.from(this.tools.values());
  }

  get(name: string): ToolDefinition<z.ZodRawShape, unknown> | undefined {
    return this.tools.get(name);
  }

  async execute(name: string, parsedArgs: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }
    const rawKey = parsedArgs.idempotency_key;
    const idempotencyKey = typeof rawKey === 'string' && rawKey.length > 0 ? rawKey : null;
    if (!idempotencyKey) {
      return tool.execute(parsedArgs, ctx);
    }

    const digest = requestDigest(name, parsedArgs);
    const existing = this.idempotency.get(idempotencyKey);
    if (existing) {
      if (existing.digest !== digest) {
        throw new StudioHttpError(409, {
          code: 'idempotency_mismatch',
          message: `Idempotency-Key "${idempotencyKey}" was already used for a different request.`,
          retryable: false,
        });
      }
      if (existing.status === 'succeeded') {
        this.setIdempotencyEntry(idempotencyKey, existing);
        return structuredClone(existing.result);
      }
      if (existing.status === 'in_flight') {
        return structuredClone(await existing.promise);
      }
    }

    const previousPartial = existing?.status === 'partial' ? existing : null;
    let savedCheckpoint: unknown;
    let hasSavedCheckpoint = false;

    const execution = (async () => {
      try {
        const result = await tool.execute(parsedArgs, {
          ...ctx,
          idempotency: {
            checkpoint: previousPartial ? structuredClone(previousPartial.checkpoint) : undefined,
            saveCheckpoint: (checkpoint) => {
              savedCheckpoint = checkpoint;
              hasSavedCheckpoint = true;
            },
          },
        });
        this.setIdempotencyEntry(idempotencyKey, {
          status: 'succeeded',
          digest,
          result: structuredClone(result),
        });
        return result;
      } catch (error) {
        if (hasSavedCheckpoint) {
          this.setIdempotencyEntry(idempotencyKey, {
            status: 'partial',
            digest,
            checkpoint: structuredClone(savedCheckpoint),
          });
        } else if (previousPartial) {
          this.setIdempotencyEntry(idempotencyKey, previousPartial);
        } else if (this.idempotency.get(idempotencyKey)?.status === 'in_flight') {
          this.idempotency.delete(idempotencyKey);
        }
        throw error;
      }
    })();

    this.setIdempotencyEntry(idempotencyKey, { status: 'in_flight', digest, promise: execution });
    return execution;
  }

  async call(name: string, rawArgs: unknown, ctx: ToolContext): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }
    const parsed = z.object(tool.inputSchema).parse(rawArgs ?? {});
    return this.execute(name, parsed, ctx);
  }
}

function formatMessageDetail(detail: Message): string {
  if (detail.parts?.length) {
    return detail.parts.map(formatMessageDetail).join('; ');
  }
  const template = (messages as Record<string, string>)[detail.key] ?? detail.key;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(detail.values?.[key] ?? key));
}

export function formatToolError(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
  message_key?: string;
  details?: Record<string, unknown>;
} {
  if (error instanceof OperationError) {
    const formatted = formatToolError(error.cause);
    return { ...formatted, details: { ...formatted.details, ...error.context } };
  }
  if (error instanceof StudioHttpError) {
    return {
      code: error.body.code,
      message: `Studio API HTTP ${error.status}: ${error.body.message}`,
      retryable: error.body.retryable,
      details: {
        status: error.status,
        ...(error.body.reason ? { reason: error.body.reason } : {}),
        ...(error.body.params ? { params: error.body.params } : {}),
        ...(error.body.current_revision !== undefined ? { current_revision: error.body.current_revision } : {}),
      },
    };
  }
  if (error instanceof MessageError) {
    return {
      code: 'domain_error',
      message_key: error.detail.key,
      message: formatMessageDetail(error.detail),
      retryable: false,
      details: { detail: error.detail },
    };
  }
  if (error instanceof z.ZodError) {
    return {
      code: 'invalid_arguments',
      message: error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; '),
      retryable: false,
    };
  }
  return {
    code: 'internal_error',
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
}
