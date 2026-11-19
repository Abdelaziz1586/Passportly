import { Module } from '@nestjs/common';
import { BlogModule } from '../blog/blog.module';
import { FlightsModule } from '../flights/flights.module';
import { HotelsModule } from '../hotels/hotels.module';
import { ItinerariesModule } from '../itineraries/itineraries.module';
import { ReportsModule } from '../reports/reports.module';
import { UsersModule } from '../users/users.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [
    UsersModule,
    FlightsModule,
    HotelsModule,
    ReportsModule,
    BlogModule,
    ItinerariesModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
