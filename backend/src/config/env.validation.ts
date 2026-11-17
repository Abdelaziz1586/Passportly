export function validateEnv(config: Record<string, unknown>) {
  if (!config.MONGODB_URI && config.NODE_ENV === 'production') {
    throw new Error('MONGODB_URI must be defined in production');
  }
  if (!config.JWT_SECRET && config.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be defined in production');
  }
  return config;
}
