import { createHmac, timingSafeEqual } from 'crypto';
import type {
  IDataObject,
  IExecuteFunctions,
  IHookFunctions,
  IHttpRequestMethods,
  ILoadOptionsFunctions,
  INodeCredentialDescription,
  INodeProperties,
  IWebhookFunctions,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';
import { isNetworkError, missingValueMessage, networkMessage, problemMessage } from './errors';

export const DEFAULT_BASE_URL = 'https://app.grades.com/api/v1';

type Context = IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions | IWebhookFunctions;

export const CONNECT_URL = 'https://my.grades.com/connect?connect=n8n';

/** The two ways to connect: sign in (OAuth2, the default from node version 2) or an API key (the version 1 default). */
export type Authentication = 'oAuth2' | 'apiKey';

export const CREDENTIAL_TYPES: Record<Authentication, string> = { oAuth2: 'gradesOAuth2Api', apiKey: 'gradesApi' };

/**
 * The node's "Authentication" choice. Version 1 nodes (workflows made before the sign-in option) resolve to apiKey and
 * version 2 nodes to oAuth2 (the parameter's default depends on the node version); no parameter at all means apiKey.
 */
export function authenticationOf(ctx: Context): Authentication {
  const value =
    'getInputData' in ctx
      ? (ctx as IExecuteFunctions).getNodeParameter('authentication', 0, 'apiKey')
      : (ctx as ILoadOptionsFunctions).getNodeParameter('authentication', 'apiKey');
  return value === 'oAuth2' ? 'oAuth2' : 'apiKey';
}

const AUTHENTICATION_OPTIONS = [
  {
    name: 'Grades.com Account (Sign In)',
    value: 'oAuth2',
    description: 'Sign in to Grades.com and approve n8n: nothing to copy (n8n 2.8 or later)',
  },
  { name: 'API Key', value: 'apiKey', description: 'A gk_live_ key from my.grades.com (Connect your AI > API keys)' },
];

/**
 * The "Authentication" parameter of both nodes. Same name twice with a different default per node version (n8n's
 * versioned-node convention): workflows saved with version 1 keep their API key credential without any change.
 */
export const AUTHENTICATION_PROPERTIES: INodeProperties[] = [
  {
    displayName: 'Authentication',
    name: 'authentication',
    type: 'options',
    noDataExpression: true,
    options: AUTHENTICATION_OPTIONS,
    default: 'oAuth2',
    displayOptions: { show: { '@version': [2] } },
  },
  {
    displayName: 'Authentication',
    name: 'authentication',
    type: 'options',
    noDataExpression: true,
    options: AUTHENTICATION_OPTIONS,
    default: 'apiKey',
    displayOptions: { show: { '@version': [1] } },
  },
];

/** The node's credentials: one per way of connecting, shown by the "Authentication" choice. */
export const CREDENTIALS: INodeCredentialDescription[] = [
  { name: 'gradesOAuth2Api', required: true, displayOptions: { show: { authentication: ['oAuth2'] } } },
  { name: 'gradesApi', required: true, displayOptions: { show: { authentication: ['apiKey'] } } },
];

export const NO_BUSINESS =
  'Your Grades.com API key does not reach any business yet. Add or claim your business at https://my.grades.com, ' +
  'or use a credential with a key created by a member of the business.';

export const NO_BUSINESS_OAUTH =
  'The Grades.com account you connected does not reach any business yet (or none was chosen when you connected). Add ' +
  'or claim your business at https://my.grades.com, or reconnect the Grades.com credential and choose your businesses.';

/** The empty-business-list message for the node's way of connecting. */
export function noBusinessMessage(ctx: Context): string {
  return authenticationOf(ctx) === 'oAuth2' ? NO_BUSINESS_OAUTH : NO_BUSINESS;
}

/** API field names -> the n8n parameter names the customer sees, for 400 field errors. */
export const FIELD_LABELS: Record<string, string> = {
  name: 'Customer Name',
  email: 'Email',
  phone: 'Phone',
  external_id: 'Customer ID',
  campaign: 'Campaign Name or ID',
  external_ref: 'Reference (Job or Invoice ID)',
  delay_minutes: 'Delay (Minutes)',
  tags: 'Tags',
  sms_consent: 'Customer Agreed to Texts',
  sms_consent_source: 'Where They Agreed to Texts',
  text: 'Reply',
  s: 'Text or Author',
  min_rating: 'Minimum Rating',
  max_rating: 'Maximum Rating',
  start_date: 'Published After',
  source_drivers: 'Sites',
  has_company_response: 'Has a Reply',
  limit: 'Limit',
  status: 'Status',
  events: 'Events',
  company: 'Business Name or ID',
  url: 'Webhook URL',
};

/**
 * One call to the Grades.com API v1 with the node's credential; answers the parsed JSON body.
 * RFC 7807 problems and connection failures become a NodeApiError whose message says what happened and what to do
 * next (errors.ts), with a short "Grades.com answered HTTP 403." description (never the raw body or the key).
 */
export async function gradesRequest(
  this: Context,
  method: IHttpRequestMethods,
  path: string,
  body?: IDataObject,
  qs?: IDataObject,
): Promise<IDataObject> {
  const authentication = authenticationOf(this);
  const credentialType = CREDENTIAL_TYPES[authentication];
  // The sign-in credential has no API URL field (its tokens are for the production API) and no key to inspect.
  const credentials = authentication === 'apiKey' ? await this.getCredentials(credentialType) : {};
  const baseURL = String(credentials.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  try {
    const response = (await this.helpers.httpRequestWithAuthentication.call(this, credentialType, {
      method,
      baseURL,
      url: path,
      json: true,
      ...(body && Object.keys(body).length > 0 ? { body } : {}),
      ...(qs && Object.keys(qs).length > 0 ? { qs } : {}),
    })) as IDataObject | undefined;
    return response ?? {};
  } catch (error) {
    throw authentication === 'oAuth2'
      ? gradesError(this, error, path, undefined, true)
      : gradesError(this, error, path, String(credentials.apiKey ?? ''));
  }
}

interface HttpFailure {
  httpCode?: string | number;
  response?: { status?: number; statusCode?: number; body?: unknown; data?: unknown; headers?: Record<string, unknown> };
}

function headerOf(headers: Record<string, unknown> | undefined, name: string): string | undefined {
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === name) {
      return Array.isArray(value) ? String(value[0]) : String(value);
    }
  }
  return undefined;
}

/**
 * n8n could not refresh the sign-in (the grant was revoked or expired: `invalid_grant`), or the credential was never
 * connected. n8n raises these itself, without an HTTP status of the API call; the text is in the error or its causes.
 */
export function needsReconnect(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    const e = current as { message?: unknown; description?: unknown; body?: { error?: unknown }; cause?: unknown; failure?: { cause?: unknown } };
    const text = `${String(e.message ?? '')} ${String(e.description ?? '')}`;
    if (
      e.body?.error === 'invalid_grant' ||
      e.failure?.cause === 'credential-invalid' ||
      /needs to be reconnected|invalid_grant|no refresh token|credentials? (are |is )?not connected|reconnect (it|the credential)/i.test(text)
    ) {
      return true;
    }
    current = e.cause;
  }
  return false;
}

/** What to do when the Grades.com sign-in no longer works (the same text as an API 401 on a sign-in connection). */
export function reconnectMessage(): string {
  return problemMessage(401, null, { app: 'n8n', connectUrl: CONNECT_URL, resubscribe: '', oauth: true });
}

/** The NodeApiError for a failed call: our message, the HTTP status, nothing raw. */
export function gradesError(ctx: Context, error: unknown, url: string, apiKey: string | undefined, oauth = false): NodeApiError {
  const err = error as HttpFailure;
  const response = err.response;
  const status = Number(response?.status ?? response?.statusCode ?? err.httpCode ?? 0);
  if (!status && oauth && needsReconnect(error)) {
    const message = reconnectMessage();
    return new NodeApiError(ctx.getNode(), { message } as never, { message, description: 'Grades.com sign-in needs renewing.' });
  }
  if (!status) {
    const code = String((error as { code?: unknown }).code ?? '');
    const message = isNetworkError(error) ? networkMessage() : 'Could not reach Grades.com. Try again in a few minutes; if it keeps happening, email support@grades.com.';
    return new NodeApiError(ctx.getNode(), { message } as never, {
      message,
      description: code !== '' ? `No answer from Grades.com (${code}).` : 'No answer from Grades.com.',
    });
  }
  let body = response?.body ?? response?.data;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }
  const message = problemMessage(
    status,
    body,
    {
      app: 'n8n',
      connectUrl: CONNECT_URL,
      resubscribe: 'Deactivate the workflow and activate it again',
      url,
      retryAfter: headerOf(response?.headers, 'retry-after'),
      apiKey,
      oauth,
      fieldLabels: FIELD_LABELS,
    },
    headerOf(response?.headers, 'www-authenticate'),
  );
  // A plain object (not the HTTP error) so NodeApiError can't pick a description or a default text from the raw body.
  return new NodeApiError(ctx.getNode(), { message, httpCode: String(status) } as never, {
    message,
    description: `Grades.com answered HTTP ${status}.`,
    httpCode: String(status),
  });
}

/** `/companies/{company}` with each path value encoded; throws when one is empty. */
export function path(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = values[key];
    if (value === undefined || value === null || String(value).trim() === '') {
      throw new Error(missingValueMessage(key));
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
