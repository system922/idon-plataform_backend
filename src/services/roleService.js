import * as roleModel from '../models/roleModel.js';

export const getAll  = (schema)         => roleModel.findAll(schema);
export const getById = (schema, id)     => roleModel.findById(schema, id);
export const remove  = (schema, id)     => roleModel.deleteById(schema, id);

export const create = (schema, { name, description, permissions }) =>
  roleModel.insert(schema, { name, description, permissions });

export const update = (schema, id, { name, description, permissions }) =>
  roleModel.updateById(schema, id, { name, description, permissions });