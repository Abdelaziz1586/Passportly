import {
  Controller,
  Delete,
  Get,
  NotImplementedException,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import { HotelsService } from './hotels.service';

@ApiTags('Hotel Bookings & Reviews')
@ApiCookieAuth()
@Controller()
export class HotelBookingsController {
  constructor(private readonly hotelsService: HotelsService) {}

  @Roles(Role.REGISTERED_USER)
  @Post('hotel-bookings')
  @ApiOperation({
    summary:
      'HTL-16, HTL-18: Create concurrency-safe single or multi-room hotel reservation',
  })
  createBooking() {
    throw new NotImplementedException(
      'POST /api/hotel-bookings not implemented yet',
    );
  }

  @Roles(Role.REGISTERED_USER, Role.ADMIN)
  @Get('hotel-bookings')
  @ApiOperation({ summary: 'HTL-20: List current user hotel bookings' })
  listBookings() {
    throw new NotImplementedException(
      'GET /api/hotel-bookings not implemented yet',
    );
  }

  @Roles(Role.REGISTERED_USER, Role.ADMIN, Role.HOTEL_MODERATOR)
  @Get('hotel-bookings/:id')
  @ApiOperation({ summary: 'HTL-20: Get hotel booking details' })
  getBooking() {
    throw new NotImplementedException(
      'GET /api/hotel-bookings/:id not implemented yet',
    );
  }

  @Roles(Role.REGISTERED_USER)
  @Post('hotel-bookings/:id/cancel')
  @ApiOperation({
    summary: 'HTL-21: Cancel hotel booking according to hotel policy',
  })
  cancelBooking() {
    throw new NotImplementedException(
      'POST /api/hotel-bookings/:id/cancel not implemented yet',
    );
  }

  @Roles(Role.REGISTERED_USER)
  @Post('hotel-bookings/:id/review')
  @ApiOperation({ summary: 'HTL-23: Submit review for completed hotel stay' })
  createReview() {
    throw new NotImplementedException(
      'POST /api/hotel-bookings/:id/review not implemented yet',
    );
  }

  @Roles(Role.REGISTERED_USER)
  @Patch('reviews/:id')
  @ApiOperation({ summary: 'HTL-23: Update own review' })
  updateReview() {
    throw new NotImplementedException(
      'PATCH /api/reviews/:id not implemented yet',
    );
  }

  @Roles(Role.REGISTERED_USER, Role.ADMIN)
  @Delete('reviews/:id')
  @ApiOperation({ summary: 'HTL-23: Delete review' })
  deleteReview() {
    throw new NotImplementedException(
      'DELETE /api/reviews/:id not implemented yet',
    );
  }

  @Roles(Role.HOTEL_MODERATOR, Role.ADMIN)
  @Post('reviews/:id/reply')
  @ApiOperation({ summary: 'HTL-26 (Optional): Reply to a hotel review' })
  replyToReview() {
    throw new NotImplementedException(
      'POST /api/reviews/:id/reply not implemented yet',
    );
  }
}
