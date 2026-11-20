import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { User, UserSchema } from './schemas/user.schema';
import {
  ModeratorAssignment,
  ModeratorAssignmentSchema,
} from './schemas/moderator-assignment.schema';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    ReferenceDataModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: ModeratorAssignment.name, schema: ModeratorAssignmentSchema },
    ]),
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService, MongooseModule],
})
export class UsersModule {}
