import Joi from 'joi';
import { ApiError } from './error.js';

/**
 * Request validation with Joi (the JS equivalent of Python's Pydantic).
 *
 * validate({ body, query, params }) runs the given schemas and replaces the
 * request part with the validated/coerced value (defaults applied, unknown
 * keys stripped). Failures become a 400 with per-field details.
 */
export function validate(schemas) {
  return (req, _res, next) => {
    const details = [];
    for (const part of ['params', 'query', 'body']) {
      const schema = schemas[part];
      if (!schema) continue;
      const { error, value } = schema.validate(req[part], {
        abortEarly: false,
        stripUnknown: true,
        convert: true,
      });
      if (error) {
        for (const d of error.details) {
          details.push({ field: d.path.join('.'), message: d.message });
        }
      } else {
        req[part] = value;
      }
    }
    if (details.length) {
      return next(
        ApiError.badRequest('validation_error', 'Request validation failed', details),
      );
    }
    return next();
  };
}

export const common = {
  slug: Joi.string().pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(24),
  sort: Joi.string()
    .valid('title', 'order', 'category', 'difficulty', 'created_at', 'updated_at')
    .default('order'),
  order: Joi.string().valid('asc', 'desc').default('asc'),
};

export default validate;
