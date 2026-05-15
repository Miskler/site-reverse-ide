import Ajv2020 from 'ajv/dist/2020';
import type { ErrorObject } from 'ajv';
import type { JsonSchema } from './schema-types';

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  validateSchema: true,
});

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateSchemaDocument(schema: JsonSchema): SchemaValidationResult {
  const valid = ajv.validateSchema(schema) === true;

  return {
    valid,
    errors: valid ? [] : formatAjvErrors(ajv.errors ?? []),
  };
}

function formatAjvErrors(errors: ErrorObject[]): string[] {
  return errors.map((error) => {
    const instancePath = error.instancePath || '#';
    return `${instancePath}: ${error.message ?? 'Schema validation error'}`;
  });
}
