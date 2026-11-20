import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { Role } from '../../common/enums';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { objectId } from './hotel-utils';
import { Hotel, HotelDocument } from './schemas/hotel.schema';
import { Room, RoomDocument } from './schemas/room.schema';

@Injectable()
export class HotelAccessService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<HotelDocument>,
    @InjectModel(Room.name) private readonly rooms: Model<RoomDocument>,
  ) {}

  assertManager(id: string, user: AuthenticatedUser): void {
    if (user.role === Role.ADMIN) return;
    if (
      user.role !== Role.HOTEL_MODERATOR ||
      user.assignedProviderType !== 'hotel' ||
      user.assignedProviderId?.toLowerCase() !== id.toLowerCase()
    ) {
      throw new ForbiddenException('You may manage only your assigned hotel');
    }
  }

  async hotel(id: string, publicOnly = false, session?: ClientSession) {
    const hotel = await this.hotels
      .findOne({
        _id: objectId(id, 'hotelId'),
        ...(publicOnly ? { isActive: true } : {}),
      })
      .session(session ?? null)
      .lean();
    if (!hotel) throw new NotFoundException('Hotel not found');
    return hotel;
  }

  async managedHotel(
    id: string,
    user: AuthenticatedUser,
    session?: ClientSession,
  ) {
    objectId(id, 'hotelId');
    this.assertManager(id, user);
    return this.hotel(id, false, session);
  }

  async room(hotelId: string, roomId: string, session?: ClientSession) {
    const room = await this.rooms
      .findOne({
        _id: objectId(roomId, 'roomId'),
        hotel: objectId(hotelId, 'hotelId'),
      })
      .session(session ?? null)
      .lean();
    if (!room) throw new NotFoundException('Room not found in this hotel');
    return room;
  }
}
