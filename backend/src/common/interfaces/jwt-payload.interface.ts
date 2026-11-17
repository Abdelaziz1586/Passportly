import { Role } from '../enums';

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  jti: string;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedUser {
  userId: string;
  email: string;
  role: Role;
  jti: string;
  assignedProviderId?: string;
  assignedProviderType?: 'airline' | 'hotel';
}
