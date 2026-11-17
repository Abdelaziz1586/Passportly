import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  UserSession,
  UserSessionDocument,
} from './schemas/user-session.schema';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) readonly userModel: Model<UserDocument>,
    @InjectModel(UserSession.name)
    readonly sessionModel: Model<UserSessionDocument>,
    readonly jwtService: JwtService,
    readonly configService: ConfigService,
  ) {}
}
