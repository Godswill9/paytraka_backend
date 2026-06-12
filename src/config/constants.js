module.exports = {
  MODES: {
    DEMO: 'demo',
    LIVE: 'live',
  },

  INVOICE_STATUS: {
    DRAFT: 'draft',
    SENT: 'sent',
    PAID: 'paid',
    OVERDUE: 'overdue',
    CANCELLED: 'cancelled',
  },

  FIRS_STATUS: {
    PENDING: 'pending',
    SUBMITTED: 'submitted',
    ACCEPTED: 'accepted',
    REJECTED: 'rejected',
    FAILED: 'failed',
  },

  SUBSCRIPTION_STATUS: {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    CANCELLED: 'cancelled',
    EXPIRED: 'expired',
  },

  PAYMENT_STATUS: {
    PENDING: 'pending',
    SUCCESS: 'success',
    FAILED: 'failed',
  },

  WITHDRAWAL_STATUS: {
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    COMPLETED: 'completed',
  },

  TICKET_STATUS: {
    OPEN: 'open',
    IN_PROGRESS: 'in_progress',
    RESOLVED: 'resolved',
    CLOSED: 'closed',
  },

  FILE_TYPES: {
    IMAGE: 'image',
    DOCUMENT: 'document',
    IMPORT: 'import',
  },

  AUDIT_ACTIONS: {
    CREATE: 'create',
    UPDATE: 'update',
    DELETE: 'delete',
    LOGIN: 'login',
    LOGOUT: 'logout',
    SUBMIT_FIRS: 'submit_firs',
    IMPORT: 'import',
    EXPORT: 'export',
  },
};
