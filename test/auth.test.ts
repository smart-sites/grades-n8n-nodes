import { NodeApiError, NodeHelpers, NodeOperationError } from 'n8n-workflow';
import type { INodeTypeDescription } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { GradesApi } from '../credentials/GradesApi.credentials';
import { GradesOAuth2Api, OAUTH_RESOURCE_URL, OAUTH_SCOPES, OAUTH_SERVER_URL } from '../credentials/GradesOAuth2Api.credentials';
import { Grades } from '../nodes/Grades/Grades.node';
import { problemMessage } from '../nodes/Grades/errors';
import { authenticationOf, gradesError, gradesRequest, needsReconnect } from '../nodes/Grades/transport';
import { GradesTrigger } from '../nodes/GradesTrigger/GradesTrigger.node';

const COMPANY = 'a15ff99c-41f2-4c9c-ac22-17c9a8a81da5';
const NODE = { name: 'Grades.com', type: 'n8n-nodes-grades.grades', typeVersion: 2, parameters: {} };

/** n8n's own resolution of the node parameters (defaults per node version), as the editor and the engine do it. */
function resolved(description: INodeTypeDescription, typeVersion: number, values: Record<string, unknown> = {}) {
  return NodeHelpers.getNodeParameters(description.properties, values as never, true, false, { typeVersion }, description) ?? {};
}

/** The credential types n8n shows (and requires) for these parameters. */
function shownCredentials(description: INodeTypeDescription, typeVersion: number, values: Record<string, unknown>) {
  return (description.credentials ?? [])
    .filter((credential) => NodeHelpers.displayParameter(values as never, credential, { typeVersion }, description))
    .map((credential) => credential.name);
}

type Call = { method: string; baseURL: string; url: string; body?: unknown };

/** An execute context (getNodeParameter(name, itemIndex, fallback)) or a hook / load-options one (name, fallback). */
function ctx(kind: 'execute' | 'hook', params: Record<string, unknown>, responses: unknown[] = [{ data: {} }], staticData: Record<string, unknown> = {}) {
  const calls: Array<{ type: string; options: Call }> = [];
  const getCredentials = vi.fn(async () => ({ apiKey: 'gk_live_test', baseUrl: 'https://staging.example.com/api/v1/' }));
  const base = {
    calls,
    getCredentials,
    getNode: () => NODE,
    continueOnFail: () => false,
    getCurrentNodeParameter: (name: string) => params[name],
    getNodeWebhookUrl: () => 'https://n8n.example.com/webhook/abc/webhook',
    getWorkflow: () => ({ name: 'Reviews to Slack' }),
    getWorkflowStaticData: () => staticData,
    logger: { warn: vi.fn() },
    helpers: {
      httpRequestWithAuthentication: vi.fn(async (type: string, options: Call) => {
        calls.push({ type, options });
        const next = responses.shift() as { __throw?: unknown } | undefined;
        if (next && next.__throw) {
          throw next.__throw;
        }
        return next;
      }),
      returnJsonArray: (items: unknown[]) => items.map((json) => ({ json })),
    },
  };
  if (kind === 'execute') {
    return {
      ...base,
      getInputData: () => [{ json: {} }],
      getNodeParameter: (name: string, _item: number, fallback?: unknown) => (name in params ? params[name] : fallback),
    };
  }
  return { ...base, getNodeParameter: (name: string, fallback?: unknown) => (name in params ? params[name] : fallback) };
}

describe('Grades.com OAuth2 credential', () => {
  const credential = new GradesOAuth2Api();
  const byName = Object.fromEntries(credential.properties.map((property) => [property.name, property]));

  it('extends n8n OAuth2 and uses dynamic client registration with PKCE, all fields fixed', () => {
    expect(credential.name).toBe('gradesOAuth2Api');
    expect(credential.displayName).toBe('Grades.com OAuth2 API');
    expect(credential.extends).toEqual(['oAuth2Api']);
    expect(credential.properties.every((property) => property.type === 'hidden')).toBe(true);
    expect(byName.useDynamicClientRegistration.default).toBe(true);
    expect(byName.serverUrl.default).toBe('https://app.grades.com/mcp/oauth');
    expect(byName.grantType.default).toBe('pkce');
    expect(byName.scope.default).toBe('companies:read reviews:read reviews:write');
    expect(byName.resourceUrl.default).toBe('https://app.grades.com/api/v1');
  });

  it('asks only for the n8n preset scopes and names a resource on the same origin as the server (n8n requires it)', () => {
    expect(OAUTH_SCOPES.split(' ').sort()).toEqual(['companies:read', 'reviews:read', 'reviews:write']);
    expect(new URL(OAUTH_RESOURCE_URL).origin).toBe(new URL(OAUTH_SERVER_URL).origin);
  });

  it('has no secret, no client id and no key of its own (n8n registers a public client)', () => {
    for (const name of ['clientId', 'clientSecret', 'authUrl', 'accessTokenUrl', 'apiKey']) {
      expect(byName[name]).toBeUndefined();
    }
  });

  it('is listed in package.json next to the API key credential', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { n8n: { credentials: string[] }; dependencies?: unknown };
    expect(pkg.n8n.credentials).toEqual(['dist/credentials/GradesApi.credentials.js', 'dist/credentials/GradesOAuth2Api.credentials.js']);
    expect(pkg.dependencies).toBeUndefined();
  });

  it('keeps the API key credential unchanged', () => {
    expect(new GradesApi().name).toBe('gradesApi');
  });
});

describe('Authentication switch (both nodes)', () => {
  for (const node of [new Grades(), new GradesTrigger()]) {
    const description = node.description;

    it(`${description.name}: version 2 is the default and signs in; version 1 keeps the API key`, () => {
      expect(description.version).toEqual([1, 2]);
      expect(description.defaultVersion).toBe(2);
      // A new node (version 2, nothing set) -> sign in.
      expect(resolved(description, 2).authentication).toBe('oAuth2');
      expect(shownCredentials(description, 2, { authentication: 'oAuth2' })).toEqual(['gradesOAuth2Api']);
      // A workflow saved before 1.1.0: version 1, no authentication parameter -> the API key credential, as before.
      expect(resolved(description, 1).authentication).toBe('apiKey');
      expect(shownCredentials(description, 1, { authentication: 'apiKey' })).toEqual(['gradesApi']);
      // Either version can switch.
      expect(shownCredentials(description, 2, { authentication: 'apiKey' })).toEqual(['gradesApi']);
      expect(shownCredentials(description, 1, { authentication: 'oAuth2' })).toEqual(['gradesOAuth2Api']);
    });

    it(`${description.name}: one Authentication parameter per version, before the others`, () => {
      const auth = description.properties.filter((property) => property.name === 'authentication');
      expect(auth.map((property) => [property.default, property.displayOptions?.show?.['@version']])).toEqual([
        ['oAuth2', [2]],
        ['apiKey', [1]],
      ]);
      expect(description.properties[0].name).toBe('authentication');
      expect(auth[0].options?.map((option) => (option as { value: string }).value)).toEqual(['oAuth2', 'apiKey']);
    });
  }
});

describe('requests per credential', () => {
  it('signs in: calls the API with the OAuth2 credential on the production URL, never reads a key', async () => {
    const context = ctx('execute', { authentication: 'oAuth2', resource: 'business', operation: 'getAll' }, [{ data: [{ uuid: COMPANY }] }]);
    const [out] = await new Grades().execute.call(context as never);
    expect(out.map((item) => item.json)).toEqual([{ uuid: COMPANY }]);
    expect(context.calls[0].type).toBe('gradesOAuth2Api');
    expect(context.calls[0].options).toMatchObject({ method: 'GET', baseURL: 'https://app.grades.com/api/v1', url: '/companies' });
    expect(context.getCredentials).not.toHaveBeenCalled();
  });

  it('API key: calls with gradesApi and the credential API URL, as in 1.0', async () => {
    const context = ctx('execute', { authentication: 'apiKey', resource: 'business', operation: 'getAll' }, [{ data: [] }]);
    await new Grades().execute.call(context as never);
    expect(context.calls[0].type).toBe('gradesApi');
    expect(context.calls[0].options.baseURL).toBe('https://staging.example.com/api/v1');
  });

  it('a node without the parameter (old workflow, old engine) uses the API key', () => {
    expect(authenticationOf(ctx('execute', {}) as never)).toBe('apiKey');
    expect(authenticationOf(ctx('hook', {}) as never)).toBe('apiKey');
    expect(authenticationOf(ctx('hook', { authentication: 'oAuth2' }) as never)).toBe('oAuth2');
  });

  it('trigger: subscribes and unsubscribes the webhook with the sign-in credential', async () => {
    const staticData: Record<string, unknown> = {};
    const trigger = new GradesTrigger();
    const create = ctx('hook', { authentication: 'oAuth2', company: COMPANY, events: ['review.created'] }, [{ data: { id: 'wh1', secret: 's' } }], staticData);
    expect(await trigger.webhookMethods.default.create.call(create as never)).toBe(true);
    expect(create.calls[0]).toMatchObject({ type: 'gradesOAuth2Api', options: { method: 'POST', url: '/webhooks' } });
    expect(staticData).toEqual({ webhookId: 'wh1', webhookSecret: 's' });

    const remove = ctx('hook', { authentication: 'oAuth2', company: COMPANY }, [{}], staticData);
    expect(await trigger.webhookMethods.default.delete.call(remove as never)).toBe(true);
    expect(remove.calls[0]).toMatchObject({ type: 'gradesOAuth2Api', options: { method: 'DELETE', url: '/webhooks/wh1' } });
  });

  it('trigger: the business list is loaded with the chosen credential and says why it is empty', async () => {
    const trigger = new GradesTrigger();
    const load = ctx('hook', { authentication: 'oAuth2' }, [{ data: [] }]);
    await expect(trigger.methods.loadOptions.getCompanies.call(load as never)).rejects.toThrow(/account you connected does not reach any business/);
    expect(load.calls[0].type).toBe('gradesOAuth2Api');
  });
});

describe('sign-in error messages', () => {
  const app = { app: 'n8n', connectUrl: 'https://my.grades.com/connect?connect=n8n', resubscribe: 'Deactivate the workflow and activate it again' };

  it('401 on a sign-in says reconnect, never "API key"', () => {
    const message = problemMessage(401, { detail: 'Unauthenticated.' }, { ...app, oauth: true });
    expect(message).toMatch(/Click Reconnect|click Reconnect/);
    expect(message).not.toMatch(/API key|gk_live_/);
  });

  it('403 missing scope on a sign-in asks to reconnect and approve', () => {
    const message = problemMessage(403, { detail: 'Token is missing the required scope: reviews:write' }, { ...app, oauth: true });
    expect(message).toMatch(/connection is not allowed.*reviews:write.*Reconnect/);
  });

  it('business-limited connection', () => {
    const message = problemMessage(400, { code: 'company_required' }, { ...app, oauth: true });
    expect(message).toMatch(/connection is limited to some businesses/);
  });

  it('the API key texts are unchanged', () => {
    expect(problemMessage(401, {}, { ...app, apiKey: 'gk_live_x' })).toMatch(/did not accept your API key/);
  });

  it('a failed token refresh (n8n "needs to be reconnected", invalid_grant) becomes the reconnect message, not "could not reach"', () => {
    const refresh = new NodeOperationError(NODE as never, 'The credential "Grades.com" needs to be reconnected.', {
      description: 'Access could not be refreshed ...',
    });
    const wrapped = new NodeApiError(NODE as never, refresh as never);
    expect(needsReconnect(wrapped)).toBe(true);
    expect(needsReconnect({ body: { error: 'invalid_grant' } })).toBe(true);
    expect(needsReconnect(new Error('OAuth access token expired and no refresh token is available. Please reconnect the credentials.'))).toBe(true);
    expect(needsReconnect({ code: 'ECONNRESET', message: 'socket hang up' })).toBe(false);

    const error = gradesError({ getNode: () => NODE } as never, refresh, '/companies', undefined, true);
    expect(error.message).toMatch(/no longer accepts this sign-in.*Reconnect/);
  });

  it('an API 401 after n8n already tried a refresh: reconnect message', async () => {
    const context = ctx('execute', { authentication: 'oAuth2', resource: 'business', operation: 'getAll' }, [
      { __throw: { httpCode: '401', response: { status: 401, body: { detail: 'Unauthenticated.' } } } },
    ]);
    await expect(gradesRequest.call(context as never, 'GET', '/companies')).rejects.toThrow(/no longer accepts this sign-in/);
  });
});
