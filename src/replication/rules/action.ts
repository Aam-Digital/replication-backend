export enum Action {
  READ = 'read',
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  WRITE = 'write', // currently no create/update/delete distinction is done
  MANAGE = 'manage', // matches any other action
}
