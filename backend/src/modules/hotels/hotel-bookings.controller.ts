import {
  Body,
  Controller,
  Delete,
  Get,
  NotImplementedException,
  Patch,
  Post,
  Param,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import { HotelsService } from './hotels.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import {
  CreateReviewDto,
  ReplyReviewDto,
  UpdateReviewDto,
} from './dto/hotel.dto';
import { HotelReviewsService } from './hotel-reviews.service';

@ApiTags('Hotel Bookings & Reviews')
@ApiCookieAuth()
@Controller()
export class HotelBookingsController {
  constructor(
    private readonly hotelsService: HotelsService,
    private readonly reviews: HotelReviewsService,
  ) {}

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
  createReview(
    @Param('id') id: string,
    @Body() dto: CreateReviewDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reviews.createReview(id, dto, user);
  }

  @Roles(Role.REGISTERED_USER)
  @Patch('reviews/:id')
  @ApiOperation({ summary: 'HTL-23: Update own review' })
  updateReview(
    @Param('id') id: string,
    @Body() dto: UpdateReviewDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reviews.updateReview(id, dto, user);
  }

  @Roles(Role.REGISTERED_USER, Role.ADMIN)
  @Delete('reviews/:id')
  @ApiOperation({ summary: 'HTL-23: Delete review' })
  deleteReview(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    void [id, user];
    throw new NotImplementedException(
      'Implemented by the subsequent SCRUM-68 PR in this stack',
    );
  }

  @Roles(Role.HOTEL_MODERATOR, Role.ADMIN)
  @Post('reviews/:id/reply')
  @ApiOperation({ summary: 'HTL-26 (Optional): Reply to a hotel review' })
  replyToReview(
    @Param('id') id: string,
    @Body() dto: ReplyReviewDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    void [id, dto, user];
    throw new NotImplementedException(
      'Implemented by the subsequent SCRUM-69 PR in this stack',
    );
  }
}
