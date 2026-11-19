import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Role } from '../../common/enums';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { UploadsService } from '../uploads/uploads.service';
import { CreateHotelDto } from './dto/hotel.dto';
import { HotelAccessService } from './hotel-access.service';
import { HotelInventoryService } from './hotel-inventory.service';
import { HotelReviewsService } from './hotel-reviews.service';
import { PLATFORM_CURRENCY } from './hotel-utils';
import {
  HotelBooking,
  HotelBookingDocument,
} from './schemas/hotel-booking.schema';
import { Hotel, HotelDocument } from './schemas/hotel.schema';
import { Review, ReviewDocument } from './schemas/review.schema';
import {
  RoomAvailability,
  RoomAvailabilityDocument,
} from './schemas/room-availability.schema';
import { Room, RoomDocument } from './schemas/room.schema';

@Injectable()
export class HotelsService {
  constructor(
    @InjectModel(Hotel.name) readonly hotelModel: Model<HotelDocument>,
    @InjectModel(Room.name) readonly roomModel: Model<RoomDocument>,
    @InjectModel(RoomAvailability.name)
    readonly roomAvailabilityModel: Model<RoomAvailabilityDocument>,
    @InjectModel(HotelBooking.name)
    readonly hotelBookingModel: Model<HotelBookingDocument>,
    @InjectModel(Review.name) readonly reviewModel: Model<ReviewDocument>,
    private readonly reference: ReferenceDataService,
    private readonly access: HotelAccessService,
    private readonly inventory: HotelInventoryService,
    private readonly reviews: HotelReviewsService,
    private readonly uploads: UploadsService,
  ) {}

  async createHotel(dto: CreateHotelDto, user: AuthenticatedUser) {
    // The official workbook reserves provider creation for administrators (HTL-01).
    if (user.role !== Role.ADMIN)
      throw new ForbiddenException('Only administrators may create hotels');
    const location = await this.reference.hotelLocation(dto.city, dto.country);
    if (
      !(await this.reference.isCurrencySupported(
        dto.baseCurrency ?? PLATFORM_CURRENCY,
      ))
    )
      throw new BadRequestException('Unsupported currency');
    const images = dto.images
      ? await this.uploads.storedImages(dto.images)
      : [];
    return this.hotelModel.create({
      ...dto,
      ...location,
      baseCurrency: PLATFORM_CURRENCY,
      images,
    });
  }
}
