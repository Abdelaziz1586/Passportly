import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { Model } from 'mongoose';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AccountStatus, Role } from '../../../common/enums';
import {
  AuthenticatedUser,
  JwtPayload,
} from '../../../common/interfaces/jwt-payload.interface';
import {
  ModeratorAssignment,
  ModeratorAssignmentDocument,
} from '../../users/schemas/moderator-assignment.schema';
import { User, UserDocument } from '../../users/schemas/user.schema';
import {
  UserSession,
  UserSessionDocument,
} from '../schemas/user-session.schema';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(UserSession.name)
    private readonly sessionModel: Model<UserSessionDocument>,
    @InjectModel(ModeratorAssignment.name)
    private readonly assignmentModel: Model<ModeratorAssignmentDocument>,
  ) {
    const cookieName = configService.get<string>(
      'jwt.cookieName',
      'access_token',
    );
    const secret = configService.get<string>(
      'jwt.secret',
      'dev-jwt-secret-change-in-production',
    );

    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) =>
          (req?.cookies?.[cookieName] as string | undefined) ?? null,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const session = await this.sessionModel
      .findOne({ jti: payload.jti, user: payload.sub })
      .lean();

    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('Session is invalid or expired');
    }

    const user = await this.userModel.findById(payload.sub).lean();
    if (!user) {
      throw new UnauthorizedException('Account not found');
    }
    if (user.status !== AccountStatus.ACTIVE) {
      throw new UnauthorizedException(
        `Account is ${user.status.toLowerCase()}`,
      );
    }

    const authUser: AuthenticatedUser = {
      userId: String(user._id),
      email: user.email,
      role: user.role,
      jti: payload.jti,
    };

    if (
      user.role === Role.AIRLINE_MODERATOR ||
      user.role === Role.HOTEL_MODERATOR
    ) {
      const assignment = await this.assignmentModel
        .findOne({ moderator: user._id, isActive: true })
        .lean();
      if (assignment) {
        authUser.assignedProviderType = assignment.providerType;
        authUser.assignedProviderId = assignment.airline
          ? String(assignment.airline)
          : assignment.hotel
            ? String(assignment.hotel)
            : undefined;
      }
    }

    return authUser;
  }
}
