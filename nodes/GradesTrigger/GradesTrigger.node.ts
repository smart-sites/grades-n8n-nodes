import type {
  IDataObject,
  IHookFunctions,
  ILoadOptionsFunctions,
  INodePropertyOptions,
  INodeType,
  INodeTypeDescription,
  IWebhookFunctions,
  IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { AUTHENTICATION_PROPERTIES, CREDENTIALS, gradesRequest, itemsOf, noBusinessMessage, signatureValid } from '../Grades/transport';

/** The Grades.com webhook events (app.grades.com WebhookEvents). */
export const EVENTS: INodePropertyOptions[] = [
  { name: 'Agent Action Pending (One Item per Draft)', value: 'agent.action.pending' },
  { name: 'Agent Action Posted', value: 'agent.action.posted' },
  { name: 'AI Reputation Changed', value: 'radar.ai_perception.changed' },
  { name: 'Review Created', value: 'review.created' },
  { name: 'Review Removed', value: 'review.removed' },
  { name: 'Review Replied To', value: 'review.replied' },
  { name: 'Review Request Clicked', value: 'review_request.clicked' },
  { name: 'Review Request Reviewed', value: 'review_request.reviewed' },
  { name: 'Review Request Unsubscribed', value: 'review_request.unsubscribed' },
  { name: 'Review Request Visited', value: 'review_request.visited' },
  { name: 'Review Page Found by the Radar (One Item per Page)', value: 'radar.mention.found' },
  { name: 'Review Updated', value: 'review.updated' },
  { name: 'Source Needs Reconnecting', value: 'source.reconnect_required' },
];

/**
 * Starts a workflow on Grades.com events: subscribes the workflow's webhook URL with POST /webhooks when the workflow is
 * activated, deletes it when deactivated, and checks every delivery's X-Grades-Signature with the endpoint's secret.
 */
export class GradesTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Grades.com Trigger',
    name: 'gradesTrigger',
    icon: { light: 'file:grades.svg', dark: 'file:grades.dark.svg' },
    group: ['trigger'],
    version: [1, 2],
    defaultVersion: 2,
    subtitle: '={{$parameter["events"].join(", ")}}',
    description: 'Starts the workflow when Grades.com finds a review, the review agent drafts a reply, and more',
    defaults: { name: 'Grades.com Trigger' },
    inputs: [],
    outputs: [NodeConnectionTypes.Main],
    credentials: CREDENTIALS,
    webhooks: [{ name: 'default', httpMethod: 'POST', responseMode: 'onReceived', path: 'webhook' }],
    properties: [
      ...AUTHENTICATION_PROPERTIES,
      {
        displayName: 'Business Name or ID',
        name: 'company',
        type: 'options',
        typeOptions: { loadOptionsMethod: 'getCompanies' },
        default: '',
        required: true,
        description:
          'The business whose events start the workflow. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
      },
      {
        displayName: 'Events',
        name: 'events',
        type: 'multiOptions',
        options: EVENTS,
        default: ['review.created'],
        required: true,
      },
    ],
  };

  methods = {
    loadOptions: {
      async getCompanies(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const response = await gradesRequest.call(this, 'GET', '/companies');
        if (((response.data ?? []) as IDataObject[]).length === 0) {
          throw new NodeOperationError(this.getNode(), noBusinessMessage(this));
        }
        return ((response.data ?? []) as IDataObject[]).map((item) => ({
          name: [item.name, item.location_nickname].filter((part) => part).join(' - '),
          value: String(item.uuid),
        }));
      },
    },
  };

  webhookMethods = {
    default: {
      async checkExists(this: IHookFunctions): Promise<boolean> {
        const data = this.getWorkflowStaticData('node');
        const url = this.getNodeWebhookUrl('default');
        const response = await gradesRequest.call(this, 'GET', '/webhooks');
        const found = ((response.data ?? []) as IDataObject[]).find(
          (endpoint) => endpoint.url === url && endpoint.id === data.webhookId && endpoint.active !== false,
        );
        return found !== undefined;
      },
      async create(this: IHookFunctions): Promise<boolean> {
        const response = await gradesRequest.call(this, 'POST', '/webhooks', {
          url: this.getNodeWebhookUrl('default'),
          company: this.getNodeParameter('company') as string,
          events: this.getNodeParameter('events') as string[],
          description: `n8n: ${this.getWorkflow().name ?? 'workflow'}`,
        });
        const endpoint = (response.data ?? {}) as IDataObject;
        if (!endpoint.id) {
          return false;
        }
        const data = this.getWorkflowStaticData('node');
        data.webhookId = endpoint.id;
        data.webhookSecret = endpoint.secret;
        return true;
      },
      async delete(this: IHookFunctions): Promise<boolean> {
        const data = this.getWorkflowStaticData('node');
        if (data.webhookId) {
          try {
            await gradesRequest.call(this, 'DELETE', `/webhooks/${encodeURIComponent(String(data.webhookId))}`);
          } catch (error) {
            // Already gone (deleted in Grades.com, or its API key was revoked): nothing to undo, but say so in the log.
            this.logger.warn(`Grades.com webhook ${String(data.webhookId)} could not be deleted: ${(error as Error).message}`);
          }
        }
        delete data.webhookId;
        delete data.webhookSecret;
        return true;
      },
    },
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const request = this.getRequestObject() as unknown as { rawBody?: Buffer | string };
    const secret = this.getWorkflowStaticData('node').webhookSecret;
    const signature = this.getHeaderData()['x-grades-signature'];
    const raw = request.rawBody === undefined ? undefined : request.rawBody.toString();

    if (typeof secret === 'string' && typeof signature === 'string' && raw !== undefined && !signatureValid(secret, raw, signature)) {
      const response = this.getResponseObject();
      response.status(401).json({ error: 'signature mismatch' });
      return { noWebhookResponse: true };
    }

    const body = this.getBodyData() as IDataObject;
    const events = this.getNodeParameter('events', []) as string[];
    if (typeof body.type !== 'string' || (events.length > 0 && !events.includes(body.type))) {
      return { workflowData: [[]] };
    }

    return { workflowData: [this.helpers.returnJsonArray(itemsOf(body))] };
  }
}
