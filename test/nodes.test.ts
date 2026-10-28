import { createHmac } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import { GradesApi } from '../credentials/GradesApi.credentials';
import { Grades } from '../nodes/Grades/Grades.node';
import { compact, itemsOf, signatureValid } from '../nodes/Grades/transport';
import { EVENTS, GradesTrigger } from '../nodes/GradesTrigger/GradesTrigger.node';

const COMPANY = 'a15ff99c-41f2-4c9c-ac22-17c9a8a81da5';

type Call = { method: string; baseURL: string; url: string; body?: unknown; qs?: unknown };

/** A minimal IExecuteFunctions / IHookFunctions: parameters, credentials and a recorded HTTP helper. */
function context(params: Record<string, unknown>, responses: unknown[] = [{ data: {} }], staticData: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const request = vi.fn(async (_type: string, options: Call) => {
    calls.push(options);
    return responses.shift();
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

  it('creates or updates a contact with tags and SMS consent', async () => {
    const ctx = context(
      {
        resource: 'contact',
        operation: 'upsert',
        company: COMPANY,
        name: 'Maria Lopez',
        email: '',
        phone: '201 555 0100',
        additionalFields: { tags: 'vip, cleaning', sms_consent: true, sms_consent_source: 'booking form' },
      },
      [{ data: { id: 'c1' } }],
    );
    await node.execute.call(ctx as never);
    expect(ctx.calls[0].body).toEqual({
      name: 'Maria Lopez',
      phone: '201 555 0100',
      tags: ['vip', 'cleaning'],
      sms_consent: true,
      sms_consent_source: 'booking form',
    });
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
