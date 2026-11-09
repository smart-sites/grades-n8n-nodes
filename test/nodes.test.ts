import { createHmac } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import { GradesApi } from '../credentials/GradesApi.credentials';
import { Grades, simplifyReview } from '../nodes/Grades/Grades.node';
import { compact, itemsOf, signatureValid } from '../nodes/Grades/transport';
import { EVENTS, GradesTrigger } from '../nodes/GradesTrigger/GradesTrigger.node';

const COMPANY = 'a15ff99c-41f2-4c9c-ac22-17c9a8a81da5';

type Call = { method: string; baseURL: string; url: string; body?: unknown; qs?: unknown };

/** A minimal IExecuteFunctions / IHookFunctions: parameters, credentials and a recorded HTTP helper. */
function context(params: Record<string, unknown>, responses: unknown[] = [{ data: {} }], staticData: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const request = vi.fn(async (_type: string, options: Call) => {
    calls.push(options);
    const next = responses.shift() as { __throw?: unknown } | undefined;
    if (next && next.__throw) {
      throw next.__throw;
    }
    return next;
  });
  const ctx = {
    calls,
    getInputData: () => [{ json: {} }],
    getNodeParameter: (name: string, _i?: number, fallback?: unknown) => (name in params ? params[name] : fallback),
    getCurrentNodeParameter: (name: string) => params[name],
    getCredentials: async () => ({ apiKey: 'gk_live_test', baseUrl: 'https://app.grades.com/api/v1' }),
    getNode: () => ({ name: 'Grades.com', type: 'n8n-nodes-grades.grades', typeVersion: 1, parameters: {} }),
    continueOnFail: () => false,
    getNodeWebhookUrl: () => 'https://n8n.example.com/webhook/abc/webhook',
    getWorkflow: () => ({ name: 'Reviews to Slack' }),
    getWorkflowStaticData: () => staticData,
    helpers: { httpRequestWithAuthentication: request, returnJsonArray: (items: unknown[]) => items.map((json) => ({ json })) },
  };
  return ctx;
}

describe('credential', () => {
  it('sends the key as a bearer token and tests it with GET /me', () => {
    const credential = new GradesApi();
    expect(credential.authenticate.properties.headers?.Authorization).toBe('=Bearer {{$credentials.apiKey}}');
    expect(credential.test.request.url).toBe('/me');
  });
});

describe('Grades.com node', () => {
  const node = new Grades();

  it('lists reviews with the filters and the limit', async () => {
    const ctx = context(
      { resource: 'review', operation: 'getAll', company: COMPANY, filters: { max_rating: 2, s: '' }, limit: 10 },
      [{ data: [{ uuid: 'r1' }, { uuid: 'r2' }] }],
    );
    const [out] = await node.execute.call(ctx as never);
    expect(out.map((item) => item.json)).toEqual([{ uuid: 'r1' }, { uuid: 'r2' }]);
    expect(ctx.calls[0]).toMatchObject({
      method: 'GET',
      baseURL: 'https://app.grades.com/api/v1',
      url: `/companies/${COMPANY}/reviews`,
      qs: { max_rating: 2, limit: 10 },
    });
  });

  const REVIEW = {
    uuid: 'r1',
    source: 'yelp_apify',
    source_name: 'Yelp',
    site: 'yelp',
    rating: 5,
    text: 'Great visit',
    author: 'Maria L.',
    avatar: 'https://example.com/a.png',
    published_at: '2026-11-01T12:00:00Z',
    external_url: 'https://www.yelp.com/biz/x',
    response_text: null,
    response_date: null,
  };

  it('filters reviews by platform: the Sites help names platforms, not collector ids', () => {
    const filters = node.description.properties.find((property) => property.name === 'filters');
    const sites = (filters?.options as Array<{ name: string; placeholder?: string; description?: string }>).find(
      (option) => option.name === 'source_drivers',
    );
    expect(sites?.placeholder).toBe('google,yelp');
    expect(`${sites?.placeholder} ${sites?.description}`).not.toMatch(/apify|google_maps|_/);
    expect(sites?.description).toContain('facebook');
  });

  it('keeps the raw review (source included) unless Simplify is on', async () => {
    const ctx = context({ resource: 'review', operation: 'getAll', company: COMPANY, filters: { source_drivers: 'google,yelp' }, limit: 5 }, [
      { data: [REVIEW] },
    ]);
    const [out] = await node.execute.call(ctx as never);
    expect(out[0].json).toEqual(REVIEW);
    expect(ctx.calls[0]).toMatchObject({ qs: { source_drivers: 'google,yelp', limit: 5 } });
  });

  it('simplified reviews put the platform first and drop the collector id', async () => {
    const list = context({ resource: 'review', operation: 'getAll', company: COMPANY, filters: {}, limit: 5, simplify: true }, [
      { data: [REVIEW] },
    ]);
    const [listed] = await node.execute.call(list as never);
    expect(Object.keys(listed[0].json).slice(0, 2)).toEqual(['source_name', 'site']);
    expect(listed[0].json).not.toHaveProperty('source');
    expect(listed[0].json).not.toHaveProperty('avatar');
    expect(listed[0].json).toMatchObject({ site: 'yelp', source_name: 'Yelp', uuid: 'r1', rating: 5, text: 'Great visit' });

    const get = context({ resource: 'review', operation: 'get', company: COMPANY, review: 'r1', simplify: true }, [{ data: REVIEW }]);
    const [got] = await node.execute.call(get as never);
    expect(got[0].json).toEqual(listed[0].json);

    // A row that carries site_name (review-request reviews, archive rows) leads with it.
    expect(Object.keys(simplifyReview({ ...REVIEW, site_name: 'Yelp' })).slice(0, 3)).toEqual(['site_name', 'source_name', 'site']);
  });

  it('replies to a review', async () => {
    const ctx = context(
      { resource: 'review', operation: 'reply', company: COMPANY, review: 'r1', text: 'Thank you!', publish: true, replace: false },
      [{ data: { status: 'published' } }],
    );
    const [out] = await node.execute.call(ctx as never);
    expect(out[0].json).toEqual({ status: 'published' });
    expect(ctx.calls[0]).toMatchObject({
      method: 'POST',
      url: `/companies/${COMPANY}/reviews/r1/reply`,
      body: { text: 'Thank you!', publish: true, replace: false },
    });
  });

  it('approves an agent action without text and lists pending ones', async () => {
    const approve = context({ resource: 'agentAction', operation: 'approve', company: COMPANY, action: 'a1', text: '' }, [
      { data: { uuid: 'a1', status: 'executed' } },
    ]);
    await node.execute.call(approve as never);
    expect(approve.calls[0]).toMatchObject({ method: 'POST', url: `/companies/${COMPANY}/agent/actions/a1/approve` });
    expect(approve.calls[0].body).toBeUndefined();

    const list = context({ resource: 'agentAction', operation: 'getAll', company: COMPANY, status: 'pending', limit: 5 }, [
      { data: [{ uuid: 'a1' }] },
    ]);
    await node.execute.call(list as never);
    expect(list.calls[0]).toMatchObject({ url: `/companies/${COMPANY}/agent/actions`, qs: { status: 'pending', limit: 5 } });
  });

  it('sends a review request with the contact nested and the reference', async () => {
    const ctx = context(
      {
        resource: 'reviewRequest',
        operation: 'send',
        company: COMPANY,
        name: 'Maria Lopez',
        email: 'maria@example.com',
        phone: '',
        additionalFields: { external_ref: 'invoice-1042', delay_minutes: 0 },
      },
      [{ data: { id: 'rq1' } }],
    );
    await node.execute.call(ctx as never);
    expect(ctx.calls[0]).toMatchObject({
      method: 'POST',
      url: `/companies/${COMPANY}/review-requests`,
      body: { contact: { name: 'Maria Lopez', email: 'maria@example.com' }, external_ref: 'invoice-1042' },
    });
  });

  it('creates or updates a contact with tags', async () => {
    const ctx = context(
      {
        resource: 'contact',
        operation: 'upsert',
        company: COMPANY,
        name: 'Maria Lopez',
        email: '',
        phone: '201 555 0100',
        additionalFields: { tags: 'vip, cleaning' },
      },
      [{ data: { id: 'c1' } }],
    );
    await node.execute.call(ctx as never);
    expect(ctx.calls[0].body).toEqual({ name: 'Maria Lopez', phone: '201 555 0100', tags: ['vip', 'cleaning'] });
  });

  it('refuses SMS consent without the consent wording, and a contact without email or phone, before calling the API', async () => {
    const sms = context({
      resource: 'contact',
      operation: 'upsert',
      company: COMPANY,
      phone: '201 555 0100',
      additionalFields: { sms_consent: true, sms_consent_source: 'booking form' },
    });
    await expect(node.execute.call(sms as never)).rejects.toThrow(
      'Customer Agreed to Texts needs the exact consent wording the customer agreed to, which this node cannot send yet ' +
        '(Grades.com text messages are not live). Turn Customer Agreed to Texts off and run again.',
    );
    expect(sms.calls).toHaveLength(0);

    for (const resource of ['contact', 'reviewRequest']) {
      const ctx = context({ resource, operation: resource === 'contact' ? 'upsert' : 'send', company: COMPANY, name: 'Maria', email: ' ', phone: '' });
      await expect(node.execute.call(ctx as never)).rejects.toThrow('An email or a phone is required: fill in Email or Phone.');
      expect(ctx.calls).toHaveLength(0);
    }
  });

  it('loads the businesses for the dropdown', async () => {
    const ctx = context({}, [{ data: [{ uuid: 'c-2', name: 'Studio', location_nickname: 'Bronx' }] }]);
    const options = await node.methods.loadOptions.getCompanies.call(ctx as never);
    expect(options).toEqual([{ name: 'Studio - Bronx', value: 'c-2' }]);
  });
});

describe('Grades.com Trigger', () => {
  const trigger = new GradesTrigger();

  it('subscribes the workflow URL, keeps the id and secret, and unsubscribes', async () => {
    const staticData: Record<string, unknown> = {};
    const ctx = context({ company: COMPANY, events: ['review.created', 'review.removed'] }, [
      { data: { id: 'wh-1', secret: 'whsec_x' } },
      { data: [{ id: 'wh-1', url: 'https://n8n.example.com/webhook/abc/webhook', active: true }] },
      undefined,
    ], staticData);

    expect(await trigger.webhookMethods.default.create.call(ctx as never)).toBe(true);
    expect(ctx.calls[0]).toMatchObject({
      method: 'POST',
      url: '/webhooks',
      body: {
        url: 'https://n8n.example.com/webhook/abc/webhook',
        company: COMPANY,
        events: ['review.created', 'review.removed'],
        description: 'n8n: Reviews to Slack',
      },
    });
    expect(staticData).toEqual({ webhookId: 'wh-1', webhookSecret: 'whsec_x' });

    expect(await trigger.webhookMethods.default.checkExists.call(ctx as never)).toBe(true);
    expect(await trigger.webhookMethods.default.delete.call(ctx as never)).toBe(true);
    expect(ctx.calls[2]).toMatchObject({ method: 'DELETE', url: '/webhooks/wh-1' });
    expect(staticData).toEqual({});
  });

  it('turns a signed delivery into items and refuses a bad signature', async () => {
    const body = {
      id: 'evt-1',
      type: 'agent.action.pending',
      created_at: 'x',
      company: { uuid: COMPANY },
      data: { pending_count: 2, actions: [{ uuid: 'a1' }, { uuid: 'a2' }] },
    };
    const raw = JSON.stringify(body);
    const t = '1793000000';
    const good = `t=${t},v1=${createHmac('sha256', 'whsec_x').update(`${t}.${raw}`).digest('hex')}`;
    const status = vi.fn(() => ({ json: vi.fn() }));
    const make = (signature: string) => ({
      ...context({ events: ['agent.action.pending'] }, [], { webhookSecret: 'whsec_x' }),
      getRequestObject: () => ({ rawBody: Buffer.from(raw) }),
      getHeaderData: () => ({ 'x-grades-signature': signature }),
      getBodyData: () => body,
      getResponseObject: () => ({ status }),
    });

    const ok = await trigger.webhook.call(make(good) as never);
    expect((ok.workflowData?.[0] ?? []).map((item) => item.json.id)).toEqual(['evt-1:a1', 'evt-1:a2']);

    const bad = await trigger.webhook.call(make(good.replace(/v1=./, 'v1=0')) as never);
    expect(bad).toEqual({ noWebhookResponse: true });
    expect(status).toHaveBeenCalledWith(401);
  });

  it('offers every Grades.com webhook event', () => {
    expect(EVENTS.map((event) => event.value).sort()).toEqual(
      [
        'agent.action.pending',
        'agent.action.posted',
        'radar.ai_perception.changed',
        'radar.mention.found',
        'review.created',
        'review.removed',
        'review.replied',
        'review.updated',
        'review_request.clicked',
        'review_request.reviewed',
        'review_request.unsubscribed',
        'review_request.visited',
        'source.reconnect_required',
      ].sort(),
    );
  });
});

describe('helpers', () => {
  it('compacts nested empty values and checks signatures', () => {
    expect(compact({ a: '', b: null, c: { d: '' }, e: 0, f: false, g: ['x'] })).toEqual({ e: 0, f: false, g: ['x'] });
    expect(signatureValid('s', 'body', 't=1,v1=' + createHmac('sha256', 's').update('1.body').digest('hex'))).toBe(true);
    expect(signatureValid('s', 'body', 'v1=abc')).toBe(false);
    expect(itemsOf({ id: 'e', type: 'review.created', created_at: 'x', company: {}, data: { review: { uuid: 'r' } } })).toEqual([
      { id: 'e', event: 'review.created', created_at: 'x', company: {}, review: { uuid: 'r' } },
    ]);
  });
});

/** A rejected HTTP call the way n8n's helper throws it (axios: response.data; legacy request: response.body). */
function httpError(status: number, body: unknown, headers: Record<string, string> = {}, legacy = false) {
  const error = Object.assign(new Error(`Request failed with status code ${status}`), {
    response: legacy ? { statusCode: status, body, headers } : { status, data: body, headers },
  });
  return { __throw: error };
}

describe('customer-facing errors (every failure a customer can hit)', () => {
  const node = new Grades();
  const reply = { resource: 'review', operation: 'reply', company: COMPANY, review: 'r1', text: 'Thanks!', publish: true, replace: false };

  async function messageOf(params: Record<string, unknown>, failure: unknown, apiKey = 'gk_live_test') {
    const ctx = context(params, [failure]);
    ctx.getCredentials = async () => ({ apiKey, baseUrl: 'https://app.grades.com/api/v1' });
    try {
      await node.execute.call(ctx as never);
    } catch (error) {
      const err = error as { message: string; description?: string; httpCode?: string | null };
      return { message: err.message, description: err.description, httpCode: err.httpCode };
    }
    throw new Error('expected the node to fail');
  }

  it('a revoked key, a mistyped key and a publishable key', async () => {
    const revoked = await messageOf(reply, httpError(401, { title: 'Unauthorized', status: 401, detail: 'Authentication required.' }));
    expect(revoked).toEqual({
      message:
        'Grades.com did not accept your API key: it was revoked, has expired or was mistyped. Create a new key at ' +
        'https://my.grades.com/connect?connect=n8n and reconnect Grades.com in n8n.',
      description: 'Grades.com answered HTTP 401.',
      httpCode: '401',
    });
    const typo = await messageOf(reply, httpError(401, { status: 401 }), 'gk_lve_abc');
    expect(typo.message).toMatch(/^This does not look like a Grades\.com API key: they start with gk_live_/);
    expect(typo.message).not.toContain('gk_lve_abc');
    const pub = await messageOf(reply, httpError(401, { status: 401 }), 'gk_pub_abc');
    expect(pub.message).toMatch(/^This is a publishable key \(gk_pub_\.\.\.\)/);
  });

  it('a read-only key (missing scope), and a 403 that is not about scopes', async () => {
    const scope = await messageOf(
      reply,
      httpError(403, { status: 403, detail: 'This credential is missing the required scope: reviews:write.', required_scopes: ['reviews:write'] }),
    );
    expect(scope.message).toBe(
      "Your Grades.com API key is not allowed to do this: it is missing the reviews:write permission (a read-only key can't " +
        'reply, send requests or start triggers). Create a key with reviews:read, reviews:write and companies:read at ' +
        'https://my.grades.com/connect?connect=n8n and reconnect Grades.com in n8n.',
    );
    const ai = await messageOf(reply, httpError(403, { status: 403, detail: 'AI reply generation is disabled' }));
    expect(ai.message).toBe(
      'AI reply generation is disabled. Turn AI replies on for this business in my.grades.com (review agent settings), or remove this step.',
    );
  });

  it('rate limit 429 (with Retry-After, legacy response shape) and a monthly limit', async () => {
    const rate = await messageOf(reply, httpError(429, { status: 429, detail: 'Too Many Attempts.' }, { 'Retry-After': '46' }, true));
    expect(rate.message).toBe(
      'Grades.com is receiving too many requests from this API key right now (the limit is 120 a minute). n8n can try ' +
        'again in 46 seconds; if this keeps happening, spread out the runs that use this key.',
    );
    const monthly = await messageOf(reply, httpError(429, { status: 429, detail: "This month's AI drafts are used up." }));
    expect(monthly.message).toBe("This month's AI drafts are used up. Try again later.");
  });

  it('plan gating: a trigger below Pro, Send Review Request below Premium, a lapsed subscription', async () => {
    const trigger = new GradesTrigger();
    const hook = context({ company: COMPANY, events: ['review.created'] }, [
      httpError(402, {
        status: 402,
        code: 'plan_upgrade_required',
        detail: 'Webhooks is not included in the Starter plan.',
        plan_required: { required_plan_name: 'Pro', upgrade_url: 'https://my.grades.com/billing?plan=pro' },
      }),
    ]);
    await expect(trigger.webhookMethods.default.create.call(hook as never)).rejects.toThrow(
      'Webhooks is not included in the Starter plan. Upgrade the business to the Pro plan at https://my.grades.com/billing?plan=pro, then try again.',
    );

    const send = await messageOf(
      { resource: 'reviewRequest', operation: 'send', company: COMPANY, email: 'm@example.com' },
      httpError(402, { status: 402, code: 'plan_upgrade_required', detail: 'Review requests is not included in the Pro plan.', required_plan_name: 'Premium' }),
    );
    expect(send.message).toBe(
      'Review requests is not included in the Pro plan. Upgrade the business to the Premium plan at https://my.grades.com/billing, then try again.',
    );
    const locked = await messageOf(reply, httpError(402, { status: 402, code: 'billing_locked', detail: 'This location is locked.' }));
    expect(locked.message).toBe('This location is locked. Update the payment details at https://my.grades.com/billing to turn changes back on.');
  });

  it('an empty account: the Business dropdowns say why they are empty', async () => {
    const ctx = context({}, [{ data: [] }, { data: [] }]);
    await expect(node.methods.loadOptions.getCompanies.call(ctx as never)).rejects.toThrow(
      'Your Grades.com API key does not reach any business yet. Add or claim your business at https://my.grades.com',
    );
    await expect(new GradesTrigger().methods.loadOptions.getCompanies.call(ctx as never)).rejects.toThrow('does not reach any business yet');
  });

  it('outages: 500, an HTML 503, and a timeout', async () => {
    const crash = await messageOf(reply, httpError(500, { status: 500, detail: 'Server Error' }));
    expect(crash.message).toBe(
      'Grades.com had a problem on its side (HTTP 500). Nothing is wrong with your n8n setup: try again in a few minutes. ' +
        'If it keeps happening, email support@grades.com.',
    );
    const html = await messageOf(reply, httpError(503, '<html>upstream connect error</html>'));
    expect(html.message).toMatch(/^Grades\.com is temporarily unavailable \(HTTP 503\)\./);
    const timeout = await messageOf(reply, { __throw: Object.assign(new Error('timeout of 300000ms exceeded'), { code: 'ECONNABORTED' }) });
    expect(timeout).toEqual({
      message:
        'Could not reach Grades.com (the connection failed or timed out). This is usually temporary: try again in a few ' +
        'minutes. If it keeps happening, email support@grades.com.',
      description: 'No answer from Grades.com (ECONNABORTED).',
      httpCode: null,
    });
  });

  it('deleted resources and validation errors', async () => {
    const review = await messageOf(reply, httpError(404, { status: 404, detail: 'Review not found' }));
    expect(review.message).toBe(
      'Grades.com could not find this review. It may have been deleted, or it belongs to another business: check the Review ID and the Business.',
    );
    const decided = await messageOf(
      { resource: 'agentAction', operation: 'approve', company: COMPANY, action: 'a1', text: '' },
      httpError(409, { status: 409, detail: 'This action is no longer pending.' }),
    );
    expect(decided.message).toBe('This action is no longer pending. Pick a draft that is still waiting for approval.');
    const invalid = await messageOf(
      { resource: 'review', operation: 'getAll', company: COMPANY, filters: { max_rating: 9 }, limit: 10 },
      httpError(400, { status: 400, detail: 'Validate Error', errors: { 'query.max_rating': ['The value must be less than or equal to 5.'] } }),
    );
    expect(invalid.message).toBe(
      'Grades.com did not accept the input of this step. Check the "Maximum Rating" field: The value must be less than or equal to 5.',
    );
    const missing = context({ resource: 'review', operation: 'get', company: COMPANY, review: '' });
    await expect(node.execute.call(missing as never)).rejects.toThrow('The "Review ID" field is empty. Choose or map a value for it and try again.');
  });

  it('never shows raw JSON, the key or n8n\'s generic status texts', async () => {
    for (const status of [400, 401, 402, 403, 404, 409, 422, 429, 500, 502, 503, 504]) {
      const error = await messageOf(reply, httpError(status, { status, detail: '{"raw":"json"}', errors: { 'body.x': ['{"a":1}'] } }));
      expect(error.message, `HTTP ${status}`).not.toMatch(/[{}]|gk_live_test|Bearer|please check|perhaps/);
      expect(error.description, `HTTP ${status}`).toBe(`Grades.com answered HTTP ${status}.`);
    }
  });

  it('the credential test explains a 401', () => {
    const rules = new GradesApi().test.rules ?? [];
    const unauthorized = rules.find((rule) => rule.type === 'responseCode' && rule.properties.value === 401);
    expect(String(unauthorized?.properties.message)).toContain('https://my.grades.com/connect?connect=n8n');
  });
});
