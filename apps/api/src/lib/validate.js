import { AppError, errors } from './errors.js';

/**
 * Schema validation built on zod, mapped onto the shared error contract so
 * clients always receive `details.fields` for form-level messaging.
 */
export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const fields = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join('.') || '_';
        if (!fields[key]) fields[key] = issue.message;
      }
      return next(
        new AppError(422, 'VALIDATION_ERROR', 'Please correct the highlighted fields.', { fields }),
      );
    }
    req[source] = result.data;
    next();
  };
}

export function assert(condition, error) {
  if (!condition) throw error;
}

export const isUuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function requireUuidParam(value, label = 'id') {
  if (!isUuid(value)) throw errors.notFound(`Invalid ${label}.`);
  return value;
}
