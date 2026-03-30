import { TOOL_DEFINITIONS } from './definitions';

export interface ToolValidationError {
  code: 'VALIDATION_ERROR';
  tool: string;
  field: string;
  expected: string;
  received: string;
  message: string;
}

interface ValidationResult {
  valid: boolean;
  errors: ToolValidationError[];
}

type JsonSchemaLike = {
  type?: string;
  properties?: Record<string, JsonSchemaLike>;
  required?: readonly string[];
  enum?: readonly unknown[];
  items?: JsonSchemaLike;
  maxLength?: number;
  maxItems?: number;
  anyOf?: readonly JsonSchemaLike[];
};

const INTERNAL_META_FIELDS = new Set(['task_progress', 'planId', 'stepId']);

export class ToolParamValidator {
  public sanitizeInternalFields(params: unknown): Record<string, unknown> {
    const source = (params && typeof params === 'object' && !Array.isArray(params))
      ? (params as Record<string, unknown>)
      : {};

    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      if (INTERNAL_META_FIELDS.has(key)) continue;
      sanitized[key] = value;
    }
    return sanitized;
  }

  public validate(toolName: string, params: unknown): ValidationResult {
    const definition = (TOOL_DEFINITIONS as unknown as Record<string, { parameters?: JsonSchemaLike }>)[toolName];
    if (!definition || !definition.parameters) {
      return {
        valid: false,
        errors: [this.error(toolName, '$', 'known tool schema', this.describeValue(params), `No schema found for tool "${toolName}"`)]
      };
    }

    const schema = definition.parameters;
    const normalized = this.sanitizeInternalFields(params);

    const errors = this.validateSchema(
      toolName,
      '$',
      normalized,
      schema,
      { strictTopLevelUnknown: true, checkTopLevelUnknown: true }
    );

    return { valid: errors.length === 0, errors };
  }

  private validateSchema(
    tool: string,
    field: string,
    value: unknown,
    schema: JsonSchemaLike,
    options: { strictTopLevelUnknown: boolean; checkTopLevelUnknown: boolean }
  ): ToolValidationError[] {
    if (schema.anyOf && schema.anyOf.length > 0) {
      const branchErrors = schema.anyOf.map((branch) =>
        this.validateSchema(tool, field, value, branch, { strictTopLevelUnknown: options.strictTopLevelUnknown, checkTopLevelUnknown: options.checkTopLevelUnknown })
      );
      if (branchErrors.some((errs) => errs.length === 0)) {
        return [];
      }
      const firstErrors = branchErrors[0] || [];
      return firstErrors.length > 0
        ? firstErrors
        : [this.error(tool, field, 'one of allowed schema variants', this.describeValue(value), 'Value does not match any allowed schema variant')];
    }

    const expectedType = schema.type;
    if (expectedType && !this.matchesType(expectedType, value)) {
      return [this.error(tool, field, expectedType, this.describeValue(value), `Invalid type for "${field}"`)];
    }

    const errors: ToolValidationError[] = [];
    if (schema.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
      const objectValue = value as Record<string, unknown>;
      const required = schema.required || [];
      const properties = schema.properties || {};

      for (const requiredField of required) {
        const requiredValue = objectValue[requiredField];
        if (requiredValue === undefined || requiredValue === null) {
          const requiredExpected = (properties[requiredField]?.type === 'string')
            ? 'non-empty string'
            : `${properties[requiredField]?.type || 'value'}`;
          errors.push(this.error(
            tool,
            this.childField(field, requiredField),
            requiredExpected,
            'undefined',
            `Missing required parameter "${requiredField}"`
          ));
          continue;
        }

        if (properties[requiredField]?.type === 'string' && String(requiredValue).trim().length === 0) {
          errors.push(this.error(
            tool,
            this.childField(field, requiredField),
            'non-empty string',
            this.describeValue(requiredValue),
            `Parameter "${requiredField}" must be a non-empty string`
          ));
        }
      }

      if (options.checkTopLevelUnknown && options.strictTopLevelUnknown) {
        const unknownFields = Object.keys(objectValue).filter((key) => !(key in properties));
        for (const unknownField of unknownFields) {
          errors.push(this.error(
            tool,
            this.childField(field, unknownField),
            'known parameter',
            this.describeValue(objectValue[unknownField]),
            `Unknown parameter "${unknownField}" is not allowed`
          ));
        }
      }

      for (const [propName, propSchema] of Object.entries(properties)) {
        if (!(propName in objectValue)) continue;
        const nestedValue = objectValue[propName];
        errors.push(
          ...this.validateSchema(
            tool,
            this.childField(field, propName),
            nestedValue,
            propSchema,
            { strictTopLevelUnknown: false, checkTopLevelUnknown: false }
          )
        );
      }
      return errors;
    }

    if (schema.type === 'string' && typeof value === 'string') {
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push(this.error(
          tool,
          field,
          `string <= ${schema.maxLength} chars`,
          `string(${value.length})`,
          `String is too long for "${field}"`
        ));
      }
      if (schema.enum && !schema.enum.includes(value)) {
        errors.push(this.error(
          tool,
          field,
          `one of [${schema.enum.join(', ')}]`,
          this.describeValue(value),
          `Invalid enum value for "${field}"`
        ));
      }
      return errors;
    }

    if (schema.type === 'number' && typeof value === 'number') {
      if (schema.enum && !schema.enum.includes(value)) {
        errors.push(this.error(
          tool,
          field,
          `one of [${schema.enum.join(', ')}]`,
          this.describeValue(value),
          `Invalid enum value for "${field}"`
        ));
      }
      return errors;
    }

    if (schema.type === 'boolean' && typeof value === 'boolean') {
      return errors;
    }

    if (schema.type === 'array' && Array.isArray(value)) {
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        errors.push(this.error(
          tool,
          field,
          `array <= ${schema.maxItems} items`,
          `array(${value.length})`,
          `Array has too many items for "${field}"`
        ));
      }
      if (schema.items) {
        value.forEach((entry, index) => {
          errors.push(
            ...this.validateSchema(
              tool,
              `${field}[${index}]`,
              entry,
              schema.items as JsonSchemaLike,
              { strictTopLevelUnknown: false, checkTopLevelUnknown: false }
            )
          );
        });
      }
      return errors;
    }

    if (schema.enum && !schema.enum.includes(value)) {
      errors.push(this.error(
        tool,
        field,
        `one of [${schema.enum.join(', ')}]`,
        this.describeValue(value),
        `Invalid enum value for "${field}"`
      ));
    }

    return errors;
  }

  private matchesType(expectedType: string, value: unknown): boolean {
    switch (expectedType) {
      case 'object':
        return value !== null && typeof value === 'object' && !Array.isArray(value);
      case 'array':
        return Array.isArray(value);
      case 'number':
        return typeof value === 'number' && Number.isFinite(value);
      case 'string':
        return typeof value === 'string';
      case 'boolean':
        return typeof value === 'boolean';
      default:
        return true;
    }
  }

  private childField(parent: string, child: string): string {
    return parent === '$' ? child : `${parent}.${child}`;
  }

  private describeValue(value: unknown): string {
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    if (Array.isArray(value)) return `array(${value.length})`;
    if (typeof value === 'string') return value.length === 0 ? 'empty string' : 'string';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'object') return 'object';
    return typeof value;
  }

  private error(tool: string, field: string, expected: string, received: string, message: string): ToolValidationError {
    return {
      code: 'VALIDATION_ERROR',
      tool,
      field,
      expected,
      received,
      message
    };
  }
}
