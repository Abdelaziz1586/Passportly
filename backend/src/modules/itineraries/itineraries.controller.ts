import {
  Body,
  Controller,
  Delete,
  Get,
  NotImplementedException,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OptionalAuth } from '../../common/decorators/optional-auth.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { CreateItineraryDto } from './dto/create-itinerary.dto';
import {
  BudgetSummaryQueryDto,
  CreateActivityDto,
  CreateBudgetEntryDto,
  CreateItineraryDayDto,
  CreateTransportCostDto,
  ListItinerariesQueryDto,
  PublicItinerarySearchQueryDto,
  ReorderItineraryDaysDto,
  UpdateActivityDto,
  UpdateBudgetEntryDto,
  UpdateItineraryDayDto,
  UpdateItineraryDto,
  UpdateTransportCostDto,
} from './dto/itinerary-endpoints.dto';
import { ItinerariesService } from './itineraries.service';

@ApiTags('Itineraries & Budgeting')
@Controller()
export class ItinerariesController {
  constructor(private readonly itinerariesService: ItinerariesService) {}

  @Public()
  @Get('itineraries/public/search')
  @ApiOperation({ summary: 'ITN-20, ITN-21: Search public itineraries' })
  searchPublicItineraries(@Query() query: PublicItinerarySearchQueryDto) {
    return this.itinerariesService.searchPublicItineraries(query);
  }

  @Public()
  @Get('itineraries/public/:id')
  @ApiOperation({ summary: 'ITN-21: View public itinerary details' })
  getPublicItinerary(@Param('id') id: string) {
    return this.itinerariesService.getPublicItinerary(id);
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
  getItinerary(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.itinerariesService.getItinerary(id, user);
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Patch('itineraries/:id')
  @ApiOperation({
    summary: 'ITN-01, ITN-20: Update itinerary metadata or visibility',
  })
  updateItinerary(
    @Param('id') id: string,
    @Body() dto: UpdateItineraryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.itinerariesService.updateItinerary(id, user.userId, dto);
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Delete('itineraries/:id')
  @ApiOperation({ summary: 'ITN-01: Delete itinerary' })
  deleteItinerary(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.itinerariesService.deleteItinerary(id, user.userId);
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Post('itineraries/:id/days')
  @ApiOperation({ summary: 'ITN-05: Add day to itinerary' })
  addDay(
    @Param('id') id: string,
    @Body() dto: CreateItineraryDayDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.itinerariesService.addDay(id, user.userId, dto);
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Patch('itineraries/:id/days/reorder')
  @ApiOperation({
    summary: 'ITN-08: Reorder itinerary days & recalculate dates',
  })
  reorderDays(
    @Param('id') id: string,
    @Body() dto: ReorderItineraryDaysDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.itinerariesService.reorderDays(id, user.userId, dto);
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Patch('itineraries/:id/days/:dayId')
  @ApiOperation({ summary: 'ITN-05: Update itinerary day' })
  updateDay(
    @Param('id') id: string,
    @Param('dayId') dayId: string,
    @Body() dto: UpdateItineraryDayDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.itinerariesService.updateDay(id, dayId, user.userId, dto);
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Delete('itineraries/:id/days/:dayId')
  @ApiOperation({
    summary: 'ITN-07: Delete itinerary day & renumber remaining days',
  })
  deleteDay(
    @Param('id') id: string,
    @Param('dayId') dayId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.itinerariesService.deleteDay(id, dayId, user.userId);
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Post('itineraries/:id/days/:dayId/activities')
  @ApiOperation({ summary: 'ITN-10: Add activity to itinerary day' })
  addActivity(
    @Param('id') id: string,
    @Param('dayId') dayId: string,
    @Body() dto: CreateActivityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.itinerariesService.addActivity(id, dayId, user.userId, dto);
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Patch('activities/:id')
  @ApiOperation({ summary: 'ITN-10: Update activity' })
  updateActivity(
    @Param('id') id: string,
    @Body() dto: UpdateActivityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.itinerariesService.updateActivity(id, user.userId, dto);
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Delete('activities/:id')
  @ApiOperation({ summary: 'ITN-10: Delete activity' })
  deleteActivity(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.itinerariesService.deleteActivity(id, user.userId);
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Post('activities/:id/images')
  @ApiOperation({ summary: 'ITN-12, GEN-08: Upload image for activity' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  uploadActivityImage(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.itinerariesService.uploadActivityImage(id, user.userId, file);
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Delete('activities/:id/images/:imageId')
  @ApiOperation({ summary: 'ITN-12: Delete activity image' })
  deleteActivityImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.itinerariesService.deleteActivityImage(
      id,
      imageId,
      user.userId,
    );
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Post('itineraries/:id/days/:dayId/budgets')
  @ApiOperation({ summary: 'ITN-14: Add budget entry to day' })
  addBudgetEntry(
    @Param('id') id: string,
    @Param('dayId') dayId: string,
    @Body() dto: CreateBudgetEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.itinerariesService.addBudgetEntry(id, dayId, user.userId, dto);
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Patch('budgets/:id')
  @ApiOperation({ summary: 'ITN-14: Update budget entry' })
  updateBudgetEntry(
    @Param('id') id: string,
    @Body() dto: UpdateBudgetEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.itinerariesService.updateBudgetEntry(id, user.userId, dto);
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Delete('budgets/:id')
  @ApiOperation({ summary: 'ITN-14: Delete budget entry' })
  deleteBudgetEntry(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.itinerariesService.deleteBudgetEntry(id, user.userId);
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Post('itineraries/:id/transport-costs')
  @ApiOperation({ summary: 'ITN-16: Add intercity transport cost' })
  addTransportCost(
    @Param('id') id: string,
    @Body() dto: CreateTransportCostDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.itinerariesService.addTransportCost(id, user.userId, dto);
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Patch('transport-costs/:id')
  @ApiOperation({ summary: 'ITN-16: Update intercity transport cost' })
  updateTransportCost(
    @Param('id') id: string,
    @Body() dto: UpdateTransportCostDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.itinerariesService.updateTransportCost(id, user.userId, dto);
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Delete('transport-costs/:id')
  @ApiOperation({ summary: 'ITN-16: Delete intercity transport cost' })
  deleteTransportCost(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.itinerariesService.deleteTransportCost(id, user.userId);
  }

  @ApiCookieAuth()
  @OptionalAuth()
  @Get('itineraries/:id/budget-summary')
  @ApiOperation({
    summary:
      'ITN-14, ITN-18: Calculate itinerary budget summary using FXRatesAPI',
  })
  getBudgetSummary(
    @Param('id') id: string,
    @Query() query: BudgetSummaryQueryDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.itinerariesService.getBudgetSummary(id, query, user);
  }

  @ApiCookieAuth()
  @Roles(Role.REGISTERED_USER)
  @Post('itineraries/:id/clone')
  @ApiOperation({
    summary: 'ITN-21: Clone public itinerary preserving attribution',
  })
  cloneItinerary(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.itinerariesService.cloneItinerary(id, user.userId);
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
