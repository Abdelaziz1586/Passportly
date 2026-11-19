import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import type { CookieOptions } from 'express';
import { isValidObjectId, Model } from 'mongoose';
import { AccountStatus, Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import {
  UserSession,
  UserSessionDocument,
} from '../auth/schemas/user-session.schema';
import { DeactivateAccountResponseDto } from './dto/deactivate-account-response.dto';
import {
  ModeratorAssignment,
  ModeratorAssignmentDocument,
} from './schemas/moderator-assignment.schema';
import { User, UserDocument } from './schemas/user.schema';

export interface DeactivateAccountResult {
  response: DeactivateAccountResponseDto;
  cookieName: string;
  clearCookieOptions: CookieOptions;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) readonly userModel: Model<UserDocument>,
    @InjectModel(ModeratorAssignment.name)
    readonly moderatorAssignmentModel: Model<ModeratorAssignmentDocument>,
    @InjectModel(UserSession.name)
    readonly sessionModel: Model<UserSessionDocument>,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Deactivates a registered traveler's account, records deactivatedAt,
   * revokes all active UserSessions, and returns httpOnly cookie-clearing options.
   */
  async deactivateMyAccount(
    currentUser: AuthenticatedUser,
  ): Promise<DeactivateAccountResult> {
    if (!isValidObjectId(currentUser.userId)) {
      throw new UnauthorizedException('Invalid authenticated user');
    }

    if (currentUser.role !== Role.REGISTERED_USER) {
      throw new ForbiddenException(
        'Only registered traveler accounts can self-deactivate',
      );
    }

    const user = await this.userModel.findById(currentUser.userId).lean();
    if (!user) {
      throw new NotFoundException('User account not found');
    }

    if (user.role !== Role.REGISTERED_USER) {
      throw new ForbiddenException(
        'Only registered traveler accounts can self-deactivate',
      );
    }

    if (user.status !== AccountStatus.ACTIVE) {
      throw new ForbiddenException(
        `Account is already ${user.status.toLowerCase()}`,
      );
    }

    const deactivatedAt = new Date();
    await this.userModel.findByIdAndUpdate(
      user._id,
      {
        $set: {
          status: AccountStatus.DEACTIVATED,
          deactivatedAt,
        },
      },
      { returnDocument: 'after' },
    );

    await this.sessionModel.updateMany(
      { user: user._id, revokedAt: null },
      { $set: { revokedAt: deactivatedAt } },
    );

    const cookieName = this.configService.get<string>(
      'jwt.cookieName',
      'access_token',
    );
    const cookieSecure = this.configService.get<boolean>(
      'jwt.cookieSecure',
      false,
    );

    return {
      response: {
        message: 'Account deactivated successfully',
        status: AccountStatus.DEACTIVATED,
        deactivatedAt,
      },
      cookieName,
      clearCookieOptions: {
        httpOnly: true,
        sameSite: 'lax',
        secure: cookieSecure,
        path: '/',
      },
    };
  }
}
