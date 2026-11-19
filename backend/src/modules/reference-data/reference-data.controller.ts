import {
  Controller,
  Get,
  NotImplementedException,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import {
  ListCitiesQueryDto,
  PaginatedCitiesResponseDto,
} from './dto/list-cities-query.dto';
import { ReferenceDataService } from './reference-data.service';

@ApiTags('Reference Data')
@Public()
@Controller()
export class ReferenceDataController {
  constructor(private readonly referenceDataService: ReferenceDataService) {}

  @Get('airports')
  @ApiOperation({
    summary: 'FLT-02: Search/list reference airports with IANA time zones',
  })
  getAirports() {
    throw new NotImplementedException('GET /api/airports not implemented yet');
  }

  @Get('countries')
  @ApiOperation({
    summary: 'List reference countries and supported currencies',
  })
  getCountries() {
    throw new NotImplementedException('GET /api/countries not implemented yet');
  }

  @Get('cities')
  @ApiOperation({ summary: 'REF-02: Search/list reference cities' })
  @ApiOkResponse({
    description: 'Paginated list of reference cities',
    type: PaginatedCitiesResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  getCities(
    @Query() query: ListCitiesQueryDto,
  ): Promise<PaginatedCitiesResponseDto> {
    return this.referenceDataService.getCities(query);
  }

  @Get('attractions')
  @ApiOperation({ summary: 'Search/list reference attractions' })
  getAttractions() {
    throw new NotImplementedException(
      'GET /api/attractions not implemented yet',
    );
  }
}
