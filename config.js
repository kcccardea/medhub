// MedHub Entra app config. Client ID and Tenant ID are public app identifiers, not
// secrets — every MSAL SPA app ships them to the browser. Auth protection comes from
// Entra's redirect URI allowlist + user sign-in. Real secrets go in config.local.js.
window.MEDHUB_CONFIG = {
  clientId: '5dc7e7a0-f45e-4cf9-a180-800458e5f178',
  tenantId: '3047bb37-4345-43fc-b42c-4350eb09bfa7',
};
