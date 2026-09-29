import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';

export * as contacts from './contacts';
export * as tags from './tags';
export * as followups from './followups';
export * as dashboard from './dashboard';
export * as data from './data';
export * as batches from './batches';
export * as auth from './auth';
export * as apiKeys from './api-keys';
export * as templates from './templates';

// Re-export shared utilities
export { logger, axiosForBackend };
