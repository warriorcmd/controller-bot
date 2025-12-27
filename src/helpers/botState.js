// Estado global y por-tenant
export const botState = {
  // Valores globales (no específicos por tenant)
  botInfo: { startTime: new Date() },
  messageStats: { sent: 0, received: 0 },
  PORT: process.env.PORT || 3000,
  // Opciones compartidas para generar QR
  qrOptions: {
    errorCorrectionLevel: 'M',
    type: 'image/png',
    quality: 0.85,
    margin: 1,
    width: 280
  }
};

// Mapa de estados por tenant. Cada tenant tendrá su propio objeto con
// sock, qrCode, isAuthenticated, connectionStatus y botInfo.phoneNumber
const tenantStates = new Map();

const createDefaultTenantState = () => ({
  sock: null,
  qrCode: null,
  isAuthenticated: false,
  connectionStatus: 'disconnected',
  botInfo: { phoneNumber: null }
});

export const getTenantState = (tenantId = 'default') => {
  if (!tenantStates.has(tenantId)) {
    tenantStates.set(tenantId, createDefaultTenantState());
  }
  return tenantStates.get(tenantId);
};

export const setTenantState = (tenantId = 'default', partial = {}) => {
  const state = getTenantState(tenantId);
  Object.assign(state, partial);
  tenantStates.set(tenantId, state);
  return state;
};

export const deleteTenantState = (tenantId = 'default') => {
  return tenantStates.delete(tenantId);
};
