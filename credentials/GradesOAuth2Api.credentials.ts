import type { ICredentialType, INodeProperties } from 'n8n-workflow';

/** The Grades.com authorization server (RFC 8414 issuer; metadata at /.well-known/oauth-authorization-server). */
export const OAUTH_SERVER_URL = 'https://app.grades.com/mcp/oauth';

/** The protected resource the tokens are for (RFC 8707 `resource`): the API v1 audience. */
export const OAUTH_RESOURCE_URL = 'https://app.grades.com/api/v1';

/** What n8n asks for: the same permissions as the n8n API key preset. */
export const OAUTH_SCOPES = 'companies:read reviews:read reviews:write';

/**
 * "Sign in with Grades.com": n8n registers itself with Grades.com (OAuth 2.0 Dynamic Client Registration, RFC 7591) as a
 * public client with PKCE, then the user signs in to Grades.com and approves. No client ID, secret or key to copy.
 *
 * Everything is fixed (hidden), so the dialog only shows the redirect URL and "Connect my account". Needs n8n 2.8 or
 * later: dynamic client registration is in the generic OAuth2 credential since 1.119, but until 2.7 n8n reads the server
 * metadata only from the origin root (https://app.grades.com/.well-known/oauth-authorization-server); 2.8-2.11 read
 * <serverUrl>/.well-known/oauth-authorization-server, 2.12+ also try RFC 9728 / RFC 8414 path-insertion, and 2.27+
 * send `resourceUrl` as the RFC 8707 resource. Older n8n: use the API key credential.
 * n8n stores the rotated refresh token on every refresh. The API sends 401 for an expired access token, which is n8n's
 * default "Token Expired Status Code".
 */
export class GradesOAuth2Api implements ICredentialType {
  name = 'gradesOAuth2Api';

  extends = ['oAuth2Api'];

  displayName = 'Grades.com OAuth2 API';

  documentationUrl = 'https://www.grades.com/integrations/n8n';

  icon = { light: 'file:grades.svg', dark: 'file:grades.dark.svg' } as const;

  properties: INodeProperties[] = [
    {
      displayName: 'Use Dynamic Client Registration',
      name: 'useDynamicClientRegistration',
      type: 'hidden',
      default: true,
    },
    {
      displayName: 'Server URL',
      name: 'serverUrl',
      type: 'hidden',
      default: OAUTH_SERVER_URL,
    },
    {
      displayName: 'Resource URL',
      name: 'resourceUrl',
      type: 'hidden',
      default: OAUTH_RESOURCE_URL,
    },
    {
      displayName: 'Grant Type',
      name: 'grantType',
      type: 'hidden',
      default: 'pkce',
    },
    {
      displayName: 'Scope',
      name: 'scope',
      type: 'hidden',
      default: OAUTH_SCOPES,
    },
  ];
}
