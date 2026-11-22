import { z } from 'zod';
import { MessageError, type Message } from '../../../frontend/src/domain/messages';
import { StudioClient, StudioHttpError } from '../client';

export type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type ToolContext = {
  client: StudioClient;
};

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

  async call(name: string, rawArgs: unknown, ctx: ToolContext): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }
    const parsed = z.object(tool.inputSchema).parse(rawArgs ?? {});
    return tool.execute(parsed, ctx);
  }
}

function formatMessageDetail(detail: Message): string {
  if (detail.parts?.length) {
    return detail.parts.map(formatMessageDetail).join('; ');
  }
  return detail.values ? `${detail.key} (${JSON.stringify(detail.values)})` : detail.key;
}

export function formatToolError(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
} {
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
