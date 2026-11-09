import type { IAuthenticateGeneric, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * A Grades.com secret API key (gk_live_...): dashboard > Connect your AI > API keys, with the scopes
 * reviews:read, reviews:write and companies:read.
 */
export class GradesApi implements ICredentialType {
  name = 'gradesApi';

  displayName = 'Grades.com API';

  documentationUrl = 'https://www.grades.com/developers#integrations';

  icon = { light: 'file:grades.svg', dark: 'file:grades.dark.svg' } as const;

  properties: INodeProperties[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      description:
        'Get a key at https://my.grades.com/connect?connect=n8n (it creates a key with reviews:read, reviews:write and companies:read for n8n) and paste it here (it starts with gk_live_)',
    },
    {
      displayName: 'API URL',
      name: 'baseUrl',
      type: 'string',
      default: 'https://app.grades.com/api/v1',
      description: 'Leave as is unless Grades.com support gives you another address',
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        Authorization: '=Bearer {{$credentials.apiKey}}',
        Accept: 'application/json',
      },
    },
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.baseUrl}}',
      url: '/me',
    },
    // Shown in the credential dialog instead of n8n's "Authorization failed - please check your credentials".
    rules: [
      {
        type: 'responseCode',
        properties: {
          value: 401,
          message:
            'Grades.com did not accept this API key: it was revoked, has expired or was mistyped (keys start with gk_live_; a ' +
            'publishable gk_pub_ key only works for website widgets). Create a new key at https://my.grades.com/connect?connect=n8n and paste it here.',
        },
      },
      {
        type: 'responseCode',
        properties: {
          value: 429,
          message: 'Grades.com is receiving too many requests from this API key right now. Wait a minute and test again.',
        },
      },
    ],
  };
}
