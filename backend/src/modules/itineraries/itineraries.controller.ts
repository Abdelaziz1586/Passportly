import {
  Body,
  Controller,
  Delete,
  Get,
  NotImplementedException,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { CreateItineraryDto } from './dto/create-itinerary.dto';
import { ListItinerariesQueryDto } from './dto/itinerary-endpoints.dto';
import { ItinerariesService } from './itineraries.service';

@ApiTags('Itineraries & Budgeting')
@Controller()
export class ItinerariesController {
  constructor(private readonly itinerariesService: ItinerariesService) {}

  @Public()
  @Get('itineraries/public/search')
  @ApiOperation({ summary: 'ITN-20, ITN-21: Search public itineraries' })
  searchPublicItineraries() {
    throw new NotImplementedException(
      'GET /api/itineraries/public/search not implemented yet',
    );
  }

  @Public()
  @Get('itineraries/public/:id')
  @ApiOperation({ summary: 'ITN-21: View public itinerary details' })
  getPublicItinerary() {
    throw new NotImplementedException(
      'GET /api/itineraries/public/:id not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Post('itineraries')
  @ApiOperation({ summary: 'ITN-01: Create itinerary' })
  @ApiCreatedResponse({ description: 'Private itinerary created successfully' })
  createItinerary(
    @Body() dto: CreateItineraryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.itinerariesService.createItinerary(user.userId, dto);
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Get('itineraries')
  @ApiOperation({ summary: 'ITN-03: List current user itineraries' })
  listMyItineraries(
    @Query() query: ListItinerariesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.itinerariesService.listMyItineraries(user.userId, query);
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER, Role.ADMIN)
  @Get('itineraries/:id')
  @ApiOperation({
    summary: 'ITN-03: Get itinerary details (with ownership check)',
  })
  getItinerary() {
    throw new NotImplementedException(
      'GET /api/itineraries/:id not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Patch('itineraries/:id')
  @ApiOperation({
    summary: 'ITN-01, ITN-20: Update itinerary metadata or visibility',
  })
  updateItinerary() {
    throw new NotImplementedException(
      'PATCH /api/itineraries/:id not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Delete('itineraries/:id')
  @ApiOperation({ summary: 'ITN-01: Delete itinerary' })
  deleteItinerary() {
    throw new NotImplementedException(
      'DELETE /api/itineraries/:id not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Post('itineraries/:id/days')
  @ApiOperation({ summary: 'ITN-05: Add day to itinerary' })
  addDay() {
    throw new NotImplementedException(
      'POST /api/itineraries/:id/days not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Patch('itineraries/:id/days/reorder')
  @ApiOperation({
    summary: 'ITN-08: Reorder itinerary days & recalculate dates',
  })
  reorderDays() {
    throw new NotImplementedException(
      'PATCH /api/itineraries/:id/days/reorder not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Patch('itineraries/:id/days/:dayId')
  @ApiOperation({ summary: 'ITN-05: Update itinerary day' })
  updateDay() {
    throw new NotImplementedException(
      'PATCH /api/itineraries/:id/days/:dayId not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Delete('itineraries/:id/days/:dayId')
  @ApiOperation({
    summary: 'ITN-07: Delete itinerary day & renumber remaining days',
  })
  deleteDay() {
    throw new NotImplementedException(
      'DELETE /api/itineraries/:id/days/:dayId not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Post('itineraries/:id/days/:dayId/activities')
  @ApiOperation({ summary: 'ITN-10: Add activity to itinerary day' })
  addActivity() {
    throw new NotImplementedException(
      'POST /api/itineraries/:id/days/:dayId/activities not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Patch('activities/:id')
  @ApiOperation({ summary: 'ITN-10: Update activity' })
  updateActivity() {
    throw new NotImplementedException(
      'PATCH /api/activities/:id not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Delete('activities/:id')
  @ApiOperation({ summary: 'ITN-10: Delete activity' })
  deleteActivity() {
    throw new NotImplementedException(
      'DELETE /api/activities/:id not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Post('activities/:id/images')
  @ApiOperation({ summary: 'ITN-12, GEN-08: Upload image for activity' })
  uploadActivityImage() {
    throw new NotImplementedException(
      'POST /api/activities/:id/images not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Delete('activities/:id/images/:imageId')
  @ApiOperation({ summary: 'ITN-12: Delete activity image' })
  deleteActivityImage() {
    throw new NotImplementedException(
      'DELETE /api/activities/:id/images/:imageId not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Post('itineraries/:id/days/:dayId/budgets')
  @ApiOperation({ summary: 'ITN-14: Add budget entry to day' })
  addBudgetEntry() {
    throw new NotImplementedException(
      'POST /api/itineraries/:id/days/:dayId/budgets not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Patch('budgets/:id')
  @ApiOperation({ summary: 'ITN-14: Update budget entry' })
  updateBudgetEntry() {
    throw new NotImplementedException(
      'PATCH /api/budgets/:id not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Delete('budgets/:id')
  @ApiOperation({ summary: 'ITN-14: Delete budget entry' })
  deleteBudgetEntry() {
    throw new NotImplementedException(
      'DELETE /api/budgets/:id not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Post('itineraries/:id/transport-costs')
  @ApiOperation({ summary: 'ITN-16: Add intercity transport cost' })
  addTransportCost() {
    throw new NotImplementedException(
      'POST /api/itineraries/:id/transport-costs not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Patch('transport-costs/:id')
  @ApiOperation({ summary: 'ITN-16: Update intercity transport cost' })
  updateTransportCost() {
    throw new NotImplementedException(
      'PATCH /api/transport-costs/:id not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Delete('transport-costs/:id')
  @ApiOperation({ summary: 'ITN-16: Delete intercity transport cost' })
  deleteTransportCost() {
    throw new NotImplementedException(
      'DELETE /api/transport-costs/:id not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Get('itineraries/:id/budget-summary')
  @ApiOperation({
    summary:
      'ITN-14, ITN-18: Calculate itinerary budget summary using FXRatesAPI',
  })
  getBudgetSummary() {
    throw new NotImplementedException(
      'GET /api/itineraries/:id/budget-summary not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Post('itineraries/:id/clone')
  @ApiOperation({
    summary: 'ITN-21: Clone public itinerary preserving attribution',
  })
  cloneItinerary() {
    throw new NotImplementedException(
      'POST /api/itineraries/:id/clone not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Get('itineraries/:id/hotels')
  @ApiOperation({ summary: 'ITN-25: Search hotels from itinerary context' })
  searchHotelsForItinerary() {
    throw new NotImplementedException(
      'GET /api/itineraries/:id/hotels not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Get('itineraries/:id/flights')
  @ApiOperation({ summary: 'ITN-26: Search flights from itinerary context' })
  searchFlightsForItinerary() {
    throw new NotImplementedException(
      'GET /api/itineraries/:id/flights not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Post('itineraries/:id/bookings')
  @ApiOperation({
    summary: 'ITN-27 (Optional): Attach confirmed booking to itinerary',
  })
  attachBooking() {
    throw new NotImplementedException(
      'POST /api/itineraries/:id/bookings not implemented yet',
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Get('itineraries/:id/pdf')
  @ApiOperation({ summary: 'ITN-28 (Optional): Export itinerary as PDF' })
  exportPdf() {
    throw new NotImplementedException(
      'GET /api/itineraries/:id/pdf not implemented yet',
    );
  }
}
