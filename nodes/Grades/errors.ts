/**
 * Customer-facing error messages: an API v1 problem (RFC 7807, app.grades.com www/docs/api-v1.md section 2) or a
 * network failure turned into plain English that says what happened and what to do next. Never raw JSON, never a
 * stack, never the key (only whether it looks like a `gk_live_` key).
 *
 * The same texts (with "Zapier" / "Make" for the platform) live in grades-zapier src/errors.ts and in the
 * Make base error block (grades-zapier scripts/build-make.ts): keep them in step.
 */

export interface ProblemContext {
  /** The platform name used in next steps: "Zapier", "Make", "n8n". */
  app: string;
  /** Where a new key is made, e.g. https://my.grades.com/connect?connect=zapier. */
  connectUrl: string;
  /** What turns a trigger off and on again on this platform, e.g. "Turn the Zap off and on again". */
  resubscribe: string;
  /** The request URL (path decides what a 404 is about). */
  url?: string;
  /** The Retry-After header of a 429. */
  retryAfter?: string | null;
  /** The key that was sent, only to say whether it looks like a secret key; never put in a message. */
  apiKey?: string;
  /** API field names (`contact.email`, `min_rating`) -> the labels the customer sees. */
  fieldLabels?: Record<string, string>;
}

export const BILLING_URL = 'https://my.grades.com/billing';
export const SUPPORT = 'support@grades.com';
export const SCOPES_TEXT = 'reviews:read, reviews:write and companies:read';

/** Laravel / validator defaults that say nothing to a customer. */
const GENERIC_DETAIL =
  /^(validate error|bad request|validation failed\.?|the given data was invalid\.?|unauthenticated\.?|unauthorized\.?|authentication required\.?|forbidden\.?|this action is unauthorized\.?|server error|internal server error|service unavailable|too many attempts\.?|too many requests\.?|payment required|not found\.?|.{0,40}\bnot found\.?|no query results for model.*|the route .* could not be found\.?)$/i;

/** A string from the problem body that is safe and useful to show (no JSON / HTML, capped). */
export function plainDetail(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  const text = value.replace(/\s+/g, ' ').trim();
  if (text === '' || /^[{[<]/.test(text)) {
    return '';
  }
  return text.length > 300 ? `${text.slice(0, 297)}...` : text;
}

function sentence(text: string): string {
  return text === '' || /[.!?]$/.test(text) ? text : `${text}.`;
}

/** The first field error of a 400 / 422 as `Check the "Email" field: The value must be an email address.` */
function fieldError(errors: unknown, labels: Record<string, string>): string {
  if (!errors || typeof errors !== 'object') {
    return '';
  }
  for (const [field, messages] of Object.entries(errors as Record<string, unknown>)) {
    const first = plainDetail(Array.isArray(messages) ? messages[0] : messages);
    if (first === '') {
      continue;
    }
    const name = field.replace(/^(body|query|path)\./, '');
    const label = labels[name] ?? labels[name.split('.').pop() ?? name] ?? name.replace(/[._]/g, ' ');
    return `Check the "${label}" field: ${sentence(first)}`;
  }
  return '';
}

/** The scopes a 403 says are missing: the detail, then `required_scopes` / `required_scope`. */
function missingScopes(problem: Record<string, unknown>, detail: string, wwwAuthenticate?: string): string | null {
  const fromDetail = /missing the required scopes?:\s*([a-z_]+:[a-z_]+(?:[ ,]+[a-z_]+:[a-z_]+)*)/i.exec(detail);
  if (fromDetail) {
    return fromDetail[1].split(/[ ,]+/).join(', ');
  }
  if (Array.isArray(problem.required_scopes) && problem.required_scopes.length > 0) {
    return problem.required_scopes.map(String).join(', ');
  }
  if (typeof problem.required_scope === 'string') {
    return problem.required_scope;
  }
  const fromHeader = /insufficient_scope".*scope="([^"]+)"/.exec(wwwAuthenticate ?? '');
  if (fromHeader) {
    return fromHeader[1].split(' ').join(', ');
  }
  return /\bscope\b/i.test(detail) ? 'needed' : null;
}

/** What a 404 is about, from the request path. */
function notFound(ctx: ProblemContext): string {
  const path = (ctx.url ?? '').split('?')[0];
  if (/\/webhooks\/(?!samples|events)[^/]+$/.test(path)) {
    return (
      'This Grades.com webhook no longer exists (it was deleted in Grades.com, or the API key that made it was removed). ' +
      `${ctx.resubscribe} to create a new one.`
    );
  }
  if (/\/agent\/actions\/[^/]+/.test(path)) {
    return (
      'Grades.com could not find this review agent draft. It may have been approved, rejected or replaced already, ' +
      'or it belongs to another business: pick a draft that is still waiting for approval.'
    );
  }
  if (/\/reviews\/[^/]+/.test(path)) {
    return (
      'Grades.com could not find this review. It may have been deleted, or it belongs to another business: ' +
      'check the Review ID and the Business.'
    );
  }
  if (/\/review-requests\/campaigns/.test(path)) {
    return 'Grades.com could not find this review-request campaign. Pick the campaign again from the list, or leave it empty for the default one.';
  }
  if (/\/companies\/[^/]+/.test(path)) {
    return (
      'Grades.com could not find this business, or your API key cannot reach it. Pick the business again from the ' +
      'Business list (an agency key reaches its client businesses only).'
    );
  }
  return 'Grades.com could not find what this step asked for. Check the IDs you mapped into it.';
}

/** The message for an HTTP error answer of the API. */
export function problemMessage(status: number, body: unknown, ctx: ProblemContext, wwwAuthenticate?: string): string {
  const problem = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const rawDetail = plainDetail(problem.detail) || plainDetail(problem.message);
  const detail = GENERIC_DETAIL.test(rawDetail) ? '' : sentence(rawDetail);
  const code = typeof problem.code === 'string' ? problem.code : '';
  const newKey = `Create a new key at ${ctx.connectUrl} and reconnect Grades.com in ${ctx.app}.`;

  if (status === 401) {
    const key = (ctx.apiKey ?? '').trim();
    let what = 'Grades.com did not accept your API key: it was revoked, has expired or was mistyped.';
    if (ctx.apiKey !== undefined && key === '') {
      what = 'No Grades.com API key was entered.';
    } else if (key.startsWith('gk_pub_')) {
      what =
        'This is a publishable key (gk_pub_...), which only works for website widgets. Grades.com secret API keys start with gk_live_.';
    } else if (key !== '' && !key.startsWith('gk_live_')) {
      what = 'This does not look like a Grades.com API key: they start with gk_live_ (check that you copied the whole key).';
    }
    return `${what} ${newKey}`;
  }

  if (status === 403) {
    const scopes = missingScopes(problem, rawDetail, wwwAuthenticate);
    if (scopes !== null) {
      const which = scopes === 'needed' ? 'a permission it needs' : `the ${scopes} permission`;
      return (
        `Your Grades.com API key is not allowed to do this: it is missing ${which} (a read-only key can't reply, ` +
        `send requests or start triggers). Create a key with ${SCOPES_TEXT} at ${ctx.connectUrl} and reconnect ` +
        `Grades.com in ${ctx.app}.`
      );
    }
    if (/\bAI\b.*\b(repl|draft)/i.test(rawDetail)) {
      return `${sentence(rawDetail)} Turn AI replies on for this business in my.grades.com (review agent settings), or remove this step.`;
    }
    return (
      `${detail || 'Grades.com refused this request.'} Your Grades.com user may need the admin role in this business: ` +
      'ask an admin of the business, or check its settings at my.grades.com.'
    );
  }

  if (status === 402) {
    const gate = (problem.plan_required && typeof problem.plan_required === 'object' ? problem.plan_required : {}) as Record<
      string,
      unknown
    >;
    const plan = plainDetail(gate.required_plan_name ?? problem.required_plan_name);
    const upgrade = typeof gate.upgrade_url === 'string' && gate.upgrade_url.startsWith('https://') ? gate.upgrade_url : BILLING_URL;
    if (code === 'billing_locked') {
      return (
        `${detail || "This business's Grades.com subscription has lapsed, so it is read-only."} ` +
        `Update the payment details at ${BILLING_URL} to turn changes back on.`
      );
    }
    if (code === 'plan_upgrade_required' || plan !== '') {
      return (
        `${detail || "This is not included in the business's Grades.com plan."} Upgrade the business to ` +
        `${plan !== '' ? `the ${plan} plan` : 'a plan that includes it'} at ${upgrade}, then try again.`
      );
    }
    return `${detail || 'This needs a paid Grades.com plan.'} Open ${BILLING_URL} to check the business's plan and payment details.`;
  }

  if (status === 404) {
    return detail !== '' && !/not found/i.test(detail) ? `${notFound(ctx)} (Grades.com said: ${detail})` : notFound(ctx);
  }

  if (status === 409) {
    if (/\/agent\/actions\//.test(ctx.url ?? '')) {
      return `${detail || 'This review agent draft was already approved or rejected.'} Pick a draft that is still waiting for approval.`;
    }
    return detail || 'Grades.com already has this change (it was made before), so nothing was done.';
  }

  if (status === 400 || status === 422) {
    const field = fieldError(problem.errors, ctx.fieldLabels ?? {});
    const lead = detail || (status === 400 ? 'Grades.com did not accept the input of this step.' : 'Grades.com could not apply this change.');
    return field !== '' && !lead.includes(field) ? `${lead} ${field}` : lead;
  }

  if (status === 429) {
    const seconds = Number.parseInt(String(ctx.retryAfter ?? ''), 10);
    if (!Number.isNaN(seconds)) {
      return (
        `Grades.com is receiving too many requests from this API key right now (the limit is 120 a minute). ` +
        `${ctx.app} can try again in ${seconds} seconds; if this keeps happening, spread out the runs that use this key.`
      );
    }
    return `${detail || 'A Grades.com usage limit was reached.'} Try again later.`;
  }

  if (status >= 500) {
    if (detail !== '') {
      return `${detail} Try again in a few minutes; if it keeps happening, email ${SUPPORT}.`;
    }
    const what = status === 500 ? `Grades.com had a problem on its side (HTTP 500).` : `Grades.com is temporarily unavailable (HTTP ${status}).`;
    return `${what} Nothing is wrong with your ${ctx.app} setup: try again in a few minutes. If it keeps happening, email ${SUPPORT}.`;
  }

  return detail !== '' ? `Grades.com answered HTTP ${status}: ${detail}` : `Grades.com answered HTTP ${status}. Try again, or email ${SUPPORT}.`;
}

/** The message for a request that got no answer (DNS, refused, reset, timeout). */
export function networkMessage(): string {
  return (
    'Could not reach Grades.com (the connection failed or timed out). This is usually temporary: try again in a few ' +
    `minutes. If it keeps happening, email ${SUPPORT}.`
  );
}

/** Errors of the HTTP layer itself (no response): node-fetch / axios / undici codes. */
export function isNetworkError(error: unknown): boolean {
  const err = error as { code?: unknown; name?: unknown; type?: unknown; cause?: { code?: unknown } };
  const code = String(err?.code ?? err?.cause?.code ?? '');
  return (
    /^(ECONN(RESET|REFUSED|ABORTED)|ETIMEDOUT|ESOCKETTIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|EHOSTUNREACH|ENETUNREACH|UND_ERR_\w+)$/.test(code) ||
    err?.name === 'FetchError' ||
    err?.name === 'AbortError' ||
    err?.name === 'TimeoutError' ||
    err?.type === 'request-timeout'
  );
}

/** A missing path value (`company`, `review`, `action`) as the field the customer fills in. */
export const PATH_LABELS: Record<string, string> = {
  company: 'Business Name or ID',
  review: 'Review ID',
  action: 'Agent Action ID',
};

export function missingValueMessage(key: string): string {
  const label = PATH_LABELS[key] ?? key;
  return `The "${label}" field is empty. Choose or map a value for it and try again.`;
}
