import { createHmac, timingSafeEqual } from 'crypto';
import type { IDataObject, IExecuteFunctions, IHookFunctions, IHttpRequestMethods, ILoadOptionsFunctions, IWebhookFunctions } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

export const DEFAULT_BASE_URL = 'https://app.grades.com/api/v1';

type Context = IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions | IWebhookFunctions;

/**
 * One call to the Grades.com API v1 with the node's credential; answers the parsed JSON body.
 * RFC 7807 problems become NodeApiError with the API's title and detail.
 */
export async function gradesRequest(
  this: Context,
  method: IHttpRequestMethods,
  path: string,
  body?: IDataObject,
  qs?: IDataObject,
): Promise<IDataObject> {
  const credentials = await this.getCredentials('gradesApi');
  const baseURL = String(credentials.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  try {
    const response = (await this.helpers.httpRequestWithAuthentication.call(this, 'gradesApi', {
      method,
      baseURL,
      url: path,
      json: true,
      ...(body && Object.keys(body).length > 0 ? { body } : {}),
      ...(qs && Object.keys(qs).length > 0 ? { qs } : {}),
    })) as IDataObject | undefined;
    return response ?? {};
  } catch (error) {
    const err = error as { description?: string; message?: string; response?: { body?: IDataObject }; cause?: unknown };
    const problem = err.response?.body;
    const message = problem
      ? [problem.title, problem.detail].filter((part) => typeof part === 'string' && part !== '').join(': ')
      : undefined;
    throw new NodeApiError(this.getNode(), error as never, message ? { message } : {});
  }
}

/** `/companies/{company}` with each path value encoded; throws when one is empty. */
export function path(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = values[key];
    if (value === undefined || value === null || String(value).trim() === '') {
      throw new Error(`${key} is required`);
    }
    return encodeURIComponent(String(value).trim());
  });
}

/** Leaves out empty strings, nulls and empty objects. */
export function compact(object: IDataObject): IDataObject {
  const out: IDataObject = {};
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      const inner = compact(value as IDataObject);
      if (Object.keys(inner).length > 0) {
        out[key] = inner;
      }
      continue;
    }
    out[key] = value;
  }
  return out;
}

/** Checks `X-Grades-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`. */
export function signatureValid(secret: string, rawBody: string, signature: string): boolean {
  const parts: Record<string, string> = {};
  for (const pair of signature.split(',')) {
    const [key, ...rest] = pair.trim().split('=');
    parts[key] = rest.join('=');
  }
  if (!parts.t || !parts.v1) {
    return false;
  }
  const expected = Buffer.from(createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex'));
  const given = Buffer.from(parts.v1);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The items one webhook delivery becomes (one per agent action / radar mention for the splitting events). */
export function itemsOf(body: IDataObject): IDataObject[] {
  const data = (body.data ?? {}) as IDataObject;
  const base = { event: body.type, created_at: body.created_at, company: body.company };
  if (body.type === 'agent.action.pending' && Array.isArray(data.actions)) {
    return (data.actions as IDataObject[]).map((action) => ({
      id: `${String(body.id)}:${String(action.uuid)}`,
      ...base,
      action,
      pending_count: data.pending_count,
    }));
  }
  if (body.type === 'radar.mention.found' && Array.isArray(data.mentions)) {
    return (data.mentions as IDataObject[]).map((mention) => ({
      id: `${String(body.id)}:${String(mention.id)}`,
      ...base,
      scan_id: data.scan_id,
      mention,
    }));
  }
  return [{ id: body.id, ...base, ...data }];
}
