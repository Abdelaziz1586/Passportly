import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import {
  ListAirportsQueryDto,
  PaginatedAirportsResponseDto,
} from './dto/list-airports-query.dto';
import {
  ListCitiesQueryDto,
  PaginatedCitiesResponseDto,
} from './dto/list-cities-query.dto';
import {
  ListAttractionsQueryDto,
  PaginatedAttractionsResponseDto,
} from './dto/list-attractions-query.dto';
import {
  ListCountriesQueryDto,
  PaginatedCountriesResponseDto,
} from './dto/list-countries-query.dto';
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
  @ApiOkResponse({
    description: 'Paginated list of reference airports with IANA time zones',
    type: PaginatedAirportsResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  getAirports(
    @Query() query: ListAirportsQueryDto,
  ): Promise<PaginatedAirportsResponseDto> {
    return this.referenceDataService.getAirports(query);
  }

  @Get('countries')
  @ApiOperation({
    summary: 'REF-01: List reference countries and supported currencies',
  })
  @ApiOkResponse({
    description: 'Paginated list of reference countries and currency codes',
    type: PaginatedCountriesResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  getCountries(
    @Query() query: ListCountriesQueryDto,
  ): Promise<PaginatedCountriesResponseDto> {
    return this.referenceDataService.getCountries(query);
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
  @ApiOperation({ summary: 'REF-03: Search/list reference attractions' })
  @ApiOkResponse({
    description: 'Paginated list of reference attractions',
    type: PaginatedAttractionsResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  getAttractions(
    @Query() query: ListAttractionsQueryDto,
  ): Promise<PaginatedAttractionsResponseDto> {
    return this.referenceDataService.getAttractions(query);
  }
}
