import type { JsonSchema } from './schema-types';

export const SAMPLE_SCHEMA: JsonSchema = {
  title: 'Catalog Entry',
  type: 'object',
  required: ['status', 'list'],
  properties: {
    status: {
      $ref: '#/$defs/status',
    },
    list: {
      type: 'array',
      items: {
        $ref: '#/$defs/item',
      },
    },
    owner: {
      anyOf: [
        {
          $ref: '#/$defs/user',
        },
        {
          type: 'string',
          enum: ['external', 'partner'],
        },
      ],
    },
    settings: {
      type: 'object',
      if: {
        properties: {
          mode: {
            const: 'strict',
          },
        },
      },
      properties: {
        mode: {
          type: 'string',
        },
      },
    },
  },
  $defs: {
    status: {
      title: 'Status',
      type: 'string',
      enum: ['draft', 'published'],
    },
    item: {
      title: 'Item',
      type: 'object',
      properties: {
        name: {
          type: 'string',
        },
        manager: {
          $ref: '#/$defs/item',
        },
      },
    },
    user: {
      title: 'User',
      type: 'object',
      properties: {
        name: {
          type: 'string',
        },
      },
    },
  },
};
