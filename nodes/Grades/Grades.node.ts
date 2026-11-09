import type {
  IDataObject,
  IExecuteFunctions,
  ILoadOptionsFunctions,
  INodeExecutionData,
  INodePropertyOptions,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { compact, gradesRequest, NO_BUSINESS, path } from './transport';

const company = {
  displayName: 'Business Name or ID',
  name: 'company',
  type: 'options' as const,
  typeOptions: { loadOptionsMethod: 'getCompanies' },
  default: '',
  required: true,
  description:
    'The business in Grades.com (an agency or multi-location key lists every business it reaches). Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
};

const show = (resource: string, operation: string[]) => ({ displayOptions: { show: { resource: [resource], operation } } });

/**
 * Grades.com: reviews, replies, the review agent, review requests and contacts (API v1, app.grades.com
 * www/docs/integrations.md). The trigger is GradesTrigger.
 */
export class Grades implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Grades.com',
    name: 'grades',
    icon: { light: 'file:grades.svg', dark: 'file:grades.dark.svg' },
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: 'Reviews, replies, the review agent and review requests on Grades.com',
    defaults: { name: 'Grades.com' },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    usableAsTool: true,
    credentials: [{ name: 'gradesApi', required: true }],
    properties: [
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'Agent Action', value: 'agentAction' },
          { name: 'Business', value: 'business' },
          { name: 'Contact', value: 'contact' },
          { name: 'Review', value: 'review' },
          { name: 'Review Request', value: 'reviewRequest' },
        ],
        default: 'review',
      },
      // Operations per resource.
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['review'] } },
        options: [
          { name: 'Get', value: 'get', action: 'Get a review' },
          { name: 'Get Many', value: 'getAll', action: 'Get many reviews' },
          { name: 'Reply', value: 'reply', action: 'Reply to a review' },
        ],
        default: 'getAll',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['agentAction'] } },
        options: [
          { name: 'Approve', value: 'approve', action: 'Approve an agent action' },
          { name: 'Get Many', value: 'getAll', action: 'Get many agent actions' },
          { name: 'Reject', value: 'reject', action: 'Reject an agent action' },
        ],
        default: 'getAll',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['reviewRequest'] } },
        options: [{ name: 'Send', value: 'send', action: 'Send a review request' }],
        default: 'send',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['contact'] } },
        options: [{ name: 'Create or Update', value: 'upsert', action: 'Create or update a contact' }],
        default: 'upsert',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['business'] } },
        options: [{ name: 'Get Many', value: 'getAll', action: 'Get many businesses' }],
        default: 'getAll',
      },
      // The business, on everything but Business > Get Many.
      { ...company, displayOptions: { show: { resource: ['review', 'agentAction', 'reviewRequest', 'contact'] } } },
      // Review.
      {
        displayName: 'Review ID',
        name: 'review',
        type: 'string',
        default: '',
        required: true,
        description: 'The review uuid (from the trigger or Get Many)',
        ...show('review', ['get', 'reply']),
      },
      { displayName: 'Reply', name: 'text', type: 'string', typeOptions: { rows: 4 }, default: '', required: true, ...show('review', ['reply']) },
      {
        displayName: 'Post to the Review Site',
        name: 'publish',
        type: 'boolean',
        default: true,
        description: 'Whether to post the reply on the site (Google); other sites store it with a link to paste it',
        ...show('review', ['reply']),
      },
      {
        displayName: 'Replace an Existing Reply',
        name: 'replace',
        type: 'boolean',
        default: false,
        description: 'Whether to overwrite a reply the review already has',
        ...show('review', ['reply']),
      },
      {
        displayName: 'Filters',
        name: 'filters',
        type: 'collection',
        placeholder: 'Add Filter',
        default: {},
        ...show('review', ['getAll']),
        options: [
          { displayName: 'Has a Reply', name: 'has_company_response', type: 'boolean', default: false },
          { displayName: 'Maximum Rating', name: 'max_rating', type: 'number', typeOptions: { minValue: 1, maxValue: 5 }, default: 5 },
          { displayName: 'Minimum Rating', name: 'min_rating', type: 'number', typeOptions: { minValue: 1, maxValue: 5 }, default: 1 },
          { displayName: 'Published After', name: 'start_date', type: 'dateTime', default: '' },
          {
            displayName: 'Sites',
            name: 'source_drivers',
            type: 'string',
            default: '',
            placeholder: 'google,yelp',
            description: 'Comma-separated review platforms to include, e.g. google, yelp, facebook, bbb, direct, grades',
          },
          { displayName: 'Text or Author', name: 's', type: 'string', default: '' },
        ],
      },
      {
        displayName: 'Simplify',
        name: 'simplify',
        type: 'boolean',
        default: false,
        description:
          'Whether to return a simplified version of the response instead of the raw data: the review platform first (Site Name or Source Name, then Site, e.g. google), without the internal collector ID (Source)',
        ...show('review', ['get', 'getAll']),
      },
      {
        displayName: 'Limit',
        name: 'limit',
        type: 'number',
        typeOptions: { minValue: 1, maxValue: 100 },
        default: 50,
        description: 'Max number of results to return',
        displayOptions: { show: { operation: ['getAll'], resource: ['review', 'agentAction'] } },
      },
      // Agent action.
      {
        displayName: 'Agent Action ID',
        name: 'action',
        type: 'string',
        default: '',
        required: true,
        description: 'The pending action uuid (from the "Agent Action Pending" trigger or Get Many)',
        ...show('agentAction', ['approve', 'reject']),
      },
      {
        displayName: 'Text (Replaces the Draft)',
        name: 'text',
        type: 'string',
        typeOptions: { rows: 4 },
        default: '',
        ...show('agentAction', ['approve']),
      },
      {
        displayName: 'Status',
        name: 'status',
        type: 'options',
        options: [
          { name: 'Pending', value: 'pending' },
          { name: 'Executed', value: 'executed' },
          { name: 'Rejected', value: 'rejected' },
          { name: 'Failed', value: 'failed' },
        ],
        default: 'pending',
        ...show('agentAction', ['getAll']),
      },
      // Contact fields (review request + contact).
      { displayName: 'Customer Name', name: 'name', type: 'string', default: '', displayOptions: { show: { resource: ['reviewRequest', 'contact'] } } },
      {
        displayName: 'Email',
        name: 'email',
        type: 'string',
        placeholder: 'name@email.com',
        default: '',
        description: 'Email or phone is required',
        displayOptions: { show: { resource: ['reviewRequest', 'contact'] } },
      },
      {
        displayName: 'Phone',
        name: 'phone',
        type: 'string',
        default: '',
        description: 'Any format; texts go out only with recorded SMS consent',
        displayOptions: { show: { resource: ['reviewRequest', 'contact'] } },
      },
      {
        displayName: 'Additional Fields',
        name: 'additionalFields',
        type: 'collection',
        placeholder: 'Add Field',
        default: {},
        ...show('reviewRequest', ['send']),
        options: [
          { displayName: 'Customer ID', name: 'external_id', type: 'string', default: '' },
          {
            displayName: 'Campaign Name or ID',
            name: 'campaign',
            type: 'options',
            typeOptions: { loadOptionsMethod: 'getCampaigns', loadOptionsDependsOn: ['company'] },
            default: '',
            description:
              'Leave empty for the default campaign. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
          },
          {
            displayName: 'Reference (Job or Invoice ID)',
            name: 'external_ref',
            type: 'string',
            default: '',
            description: 'Sending again with the same reference never sends twice',
          },
          { displayName: 'Delay (Minutes)', name: 'delay_minutes', type: 'number', typeOptions: { minValue: 0, maxValue: 43200 }, default: 0 },
        ],
      },
      {
        displayName: 'Additional Fields',
        name: 'additionalFields',
        type: 'collection',
        placeholder: 'Add Field',
        default: {},
        ...show('contact', ['upsert']),
        options: [
          { displayName: 'Customer ID', name: 'external_id', type: 'string', default: '' },
          { displayName: 'Tags', name: 'tags', type: 'string', default: '', description: 'Comma-separated' },
          { displayName: 'Customer Agreed to Texts', name: 'sms_consent', type: 'boolean', default: false },
          { displayName: 'Where They Agreed to Texts', name: 'sms_consent_source', type: 'string', default: '' },
        ],
      },
    ],
  };

  methods = {
    loadOptions: {
      async getCompanies(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const response = await gradesRequest.call(this, 'GET', '/companies');
        if (((response.data ?? []) as IDataObject[]).length === 0) {
          throw new NodeOperationError(this.getNode(), NO_BUSINESS);
        }
        return ((response.data ?? []) as IDataObject[]).map((item) => ({
          name: [item.name, item.location_nickname].filter((part) => part).join(' - '),
          value: String(item.uuid),
        }));
      },
      async getCampaigns(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const companyId = this.getCurrentNodeParameter('company') as string;
        if (!companyId) {
          return [];
        }
        const response = await gradesRequest.call(this, 'GET', path('/companies/{company}/review-requests/campaigns', { company: companyId }));
        return ((response.data ?? []) as IDataObject[]).map((item) => ({ name: String(item.name), value: String(item.id) }));
      },
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const out: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      try {
        const results = await runOne.call(this, i);
        for (const json of results) {
          out.push({ json, pairedItem: { item: i } });
        }
      } catch (error) {
        if (this.continueOnFail()) {
          out.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
          continue;
        }
        throw error instanceof NodeApiError ? error : new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
      }
    }

    return [out];
  }
}

/** One input item: the request of the chosen resource and operation. */
async function runOne(this: IExecuteFunctions, i: number): Promise<IDataObject[]> {
  const resource = this.getNodeParameter('resource', i) as string;
  const operation = this.getNodeParameter('operation', i) as string;
  const param = (name: string, fallback: unknown = '') => this.getNodeParameter(name, i, fallback) as never;
  const companyId = resource === 'business' ? '' : (param('company') as string);
  const one = (response: IDataObject): IDataObject[] => [(response.data ?? {}) as IDataObject];
  const many = (response: IDataObject): IDataObject[] => (response.data ?? []) as IDataObject[];
  const simplifyIf = (reviews: IDataObject[]): IDataObject[] => (param('simplify', false) ? reviews.map(simplifyReview) : reviews);

  if (resource === 'business') {
    return many(await gradesRequest.call(this, 'GET', '/companies'));
  }

  if (resource === 'review') {
    if (operation === 'getAll') {
      const filters = compact(param('filters', {}) as IDataObject);
      return simplifyIf(
        many(
          await gradesRequest.call(this, 'GET', path('/companies/{company}/reviews', { company: companyId }), undefined, {
            ...filters,
            limit: param('limit', 50),
          }),
        ),
      );
    }
    const reviewPath = path('/companies/{company}/reviews/{review}', { company: companyId, review: param('review') });
    if (operation === 'get') {
      return simplifyIf(one(await gradesRequest.call(this, 'GET', reviewPath)));
    }
    return one(
      await gradesRequest.call(this, 'POST', `${reviewPath}/reply`, {
        text: param('text'),
        publish: param('publish', true),
        replace: param('replace', false),
      }),
    );
  }

  if (resource === 'agentAction') {
    const base = path('/companies/{company}/agent/actions', { company: companyId });
    if (operation === 'getAll') {
      return many(await gradesRequest.call(this, 'GET', base, undefined, { status: param('status', 'pending'), limit: param('limit', 50) }));
    }
    const actionPath = `${base}/${path('{action}', { action: param('action') })}`;
    if (operation === 'approve') {
      return one(await gradesRequest.call(this, 'POST', `${actionPath}/approve`, compact({ text: param('text') })));
    }
    return one(await gradesRequest.call(this, 'POST', `${actionPath}/reject`));
  }

  const extra = param('additionalFields', {}) as IDataObject;
  const contact = compact({ name: param('name'), email: param('email'), phone: param('phone'), external_id: extra.external_id });
  // Checked here: the API's answer is a 400 "Validate Error" that names only one field (F10).
  if (String(contact.email ?? '').trim() === '' && String(contact.phone ?? '').trim() === '') {
    throw new NodeOperationError(this.getNode(), 'An email or a phone is required: fill in Email or Phone.', { itemIndex: i });
  }
  if (resource === 'contact' && extra.sms_consent) {
    throw new NodeOperationError(
      this.getNode(),
      'Customer Agreed to Texts needs the exact consent wording the customer agreed to, which this node cannot send yet ' +
        '(Grades.com text messages are not live). Turn Customer Agreed to Texts off and run again.',
      { itemIndex: i },
    );
  }

  if (resource === 'reviewRequest') {
    return one(
      await gradesRequest.call(
        this,
        'POST',
        path('/companies/{company}/review-requests', { company: companyId }),
        compact({ contact, campaign: extra.campaign, external_ref: extra.external_ref, delay_minutes: extra.delay_minutes || undefined }),
      ),
    );
  }

  // contact > upsert
  const tags = typeof extra.tags === 'string' ? extra.tags.split(',').map((tag) => tag.trim()).filter((tag) => tag !== '') : [];
  return one(
    await gradesRequest.call(
      this,
      'POST',
      path('/companies/{company}/review-requests/contacts', { company: companyId }),
      compact({
        ...contact,
        ...(tags.length > 0 ? { tags } : {}),
        ...(extra.sms_consent ? { sms_consent: true, sms_consent_source: extra.sms_consent_source } : {}),
      }),
    ),
  );
}

/** Simplified review fields, in order. `site` is the review platform (google, yelp, ...). */
const SIMPLE_REVIEW_FIELDS = [
  'site_name',
  'source_name',
  'site',
  'uuid',
  'rating',
  'author',
  'text',
  'published_at',
  'external_url',
  'response_text',
  'response_date',
];

/**
 * A review with the platform first (`site_name` when present, `source_name`, `site`) and without `source`, the internal
 * collector id (e.g. yelp_apify) that may change. The raw output keeps every field, `source` included.
 */
export function simplifyReview(review: IDataObject): IDataObject {
  const out: IDataObject = {};
  for (const key of SIMPLE_REVIEW_FIELDS) {
    if (review[key] !== undefined) {
      out[key] = review[key];
    }
  }
  return out;
}
