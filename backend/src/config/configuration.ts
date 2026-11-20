export interface AppConfig {
  nodeEnv: string;
  port: number;
  frontendUrl: string;
  mongodbUri: string;
  jwt: {
    secret: string;
    expiresIn: string;
    cookieName: string;
    cookieSecure: boolean;
  };
  seedAdmin: {
    email: string;
    password: string;
  };
  stripe: {
    secretKey: string;
    webhookSecret: string;
  };
  fxRates: {
    baseUrl: string;
    apiKey: string;
  };
  uploads: {
    dir: string;
    maxImageSizeBytes: number;
  };
  mail: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
    appBaseUrl: string;
  };
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3001',
  mongodbUri:
    process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/travel_platform',
  jwt: {
    secret: process.env.JWT_SECRET ?? 'dev-jwt-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '1d',
    cookieName: process.env.COOKIE_NAME ?? 'access_token',
    cookieSecure: process.env.COOKIE_SECURE === 'true',
  },
  seedAdmin: {
    email: process.env.SEED_ADMIN_EMAIL ?? 'admin@travelplatform.local',
    password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!',
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  },
  fxRates: {
    baseUrl: process.env.FXRATES_API_BASE_URL ?? 'https://api.fxratesapi.com',
    apiKey: process.env.FXRATES_API_KEY ?? '',
  },
  uploads: {
    dir: process.env.UPLOAD_DIR ?? 'uploads',
    maxImageSizeBytes: parseInt(
      process.env.MAX_IMAGE_SIZE_BYTES ?? String(5 * 1024 * 1024),
      10,
    ),
  },
  mail: {
    host: process.env.SMTP_HOST ?? '',
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.MAIL_FROM ?? 'Passportly <no-reply@passportly.local>',
    appBaseUrl:
      process.env.APP_BASE_URL ??
      `http://localhost:${parseInt(process.env.PORT ?? '3000', 10)}`,
  },
});
