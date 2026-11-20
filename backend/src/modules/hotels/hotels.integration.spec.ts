import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Model, Types } from 'mongoose';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as os from 'node:os';
import * as path from 'node:path';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  AccountStatus,
  BookingStatus,
  ProviderType,
  Role,
} from '../../common/enums';
import { AllExceptionsFilter } from '../../common/filters/http-exception.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import {
  UserSession,
  UserSessionSchema,
} from '../auth/schemas/user-session.schema';
import { City } from '../reference-data/schemas/city.schema';
import { Country } from '../reference-data/schemas/country.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  ModeratorAssignment,
  ModeratorAssignmentSchema,
} from '../users/schemas/moderator-assignment.schema';
import { AuditLog } from '../audit-logs/schemas/audit-log.schema';
import { HotelsModule } from './hotels.module';
import { HotelReviewsService } from './hotel-reviews.service';
import { Hotel } from './schemas/hotel.schema';
import { HotelBooking } from './schemas/hotel-booking.schema';
import { Review } from './schemas/review.schema';
import { Room } from './schemas/room.schema';
import { RoomAvailability } from './schemas/room-availability.schema';
import { dateRange, DAY_MS, todayUtc } from './hotel-utils';

// Each ticket branch activates its completed prefix; the final branch runs all 18 groups.
const implementedTickets = new Set(
  Array.from({ length: 3 }, (_, i) => `SCRUM-${52 + i}`),
);
const ticket = (id: string, tests: () => void): void => {
  (implementedTickets.has(id) ? describe : describe.skip)(id, tests);
};

interface Page<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
interface RoomView {
  _id: string;
  minimumAvailableUnits: number;
  totalStayPrice: number;
  averagePricePerNight: number;
  numberOfBeds: number;
}
interface HotelView {
  _id: string;
  name: string;
  pricePerNight: number;
  averageRating: number;
  reviewCount: number;
}
interface ReviewView {
  _id: string;
  rating: number;
  authorName: string;
  comment: string;
  moderatorReply: { replyText: string } | null;
}
type ReviewPage = Page<ReviewView> & {
  averageRating: number;
  reviewCount: number;
  ratingBreakdown: Record<string, number>;
};
const body = <T = unknown>(response: request.Response): T => response.body as T;

describe('Hotel ticket API integration (real MongoDB replica set)', () => {
  let mongo: MongoMemoryReplSet;
  let app: INestApplication<App>;
  let uploadDir: string;
  let hotels: Model<Hotel>;
  let rooms: Model<Room>;
  let availability: Model<RoomAvailability>;
  let bookings: Model<HotelBooking>;
  let reviews: Model<Review>;
  let users: Model<User>;
  let sessions: Model<UserSession>;
  let assignments: Model<ModeratorAssignment>;
  let countries: Model<Country>;
  let cities: Model<City>;
  let hotelId: string;
  let otherHotelId: string;
  let roomId: string;
  let cityId: string;
  let countryId: string;
  let otherCountryId: string;
  let travelerId: string;
  let strangerId: string;
  let adminCookie: string;
  let moderatorCookie: string;
  let otherModeratorCookie: string;
  let travelerCookie: string;
  let strangerCookie: string;
  let airlineCookie: string;
  let startDate: string;
  let endDate: string;
  const jsonDate = (offset: number) =>
    new Date(todayUtc().getTime() + offset * DAY_MS).toISOString().slice(0, 10);
  const hotelPath = (suffix = '') => `/api/hotels/${hotelId}${suffix}`;
  const roomPath = (suffix = '') => hotelPath(`/rooms/${roomId}${suffix}`);
  const stay = () => ({
    checkInDate: startDate,
    checkOutDate: endDate,
    guestCount: 2,
  });
  const range = () => ({ startDate, endDate });
  const newRoom = () => ({
    name: 'Room 102',
    roomType: 'Double',
    numberOfBeds: 2,
    maxOccupancy: 2,
    basePricePerNight: 80,
    totalUnits: 1,
  });

  beforeAll(async () => {
    uploadDir = await mkdtemp(path.join(tmpdir(), 'passportly-hotel-test-'));
    const secret = randomBytes(48).toString('hex');
    mongo = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          skipProcessEnv: true,
          load: [
            () => ({
              jwt: { secret, cookieName: 'access_token' },
              uploads: { dir: uploadDir },
            }),
          ],
        }),
        MongooseModule.forRoot(mongo.getUri(), {
          dbName: 'passportly_hotel_tests',
          // The driver dynamically imports OS APIs by default; Jest's VM needs an explicit adapter.
          runtimeAdapters: { os },
          retryAttempts: 1,
          serverSelectionTimeoutMS: 5000,
        }),
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({ secret }),
        MongooseModule.forFeature([
          { name: User.name, schema: UserSchema },
          { name: UserSession.name, schema: UserSessionSchema },
          { name: ModeratorAssignment.name, schema: ModeratorAssignmentSchema },
        ]),
        HotelsModule,
      ],
      providers: [
        JwtStrategy,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    hotels = app.get(getModelToken(Hotel.name));
    rooms = app.get(getModelToken(Room.name));
    availability = app.get(getModelToken(RoomAvailability.name));
    bookings = app.get(getModelToken(HotelBooking.name));
    reviews = app.get(getModelToken(Review.name));
    users = app.get(getModelToken(User.name));
    sessions = app.get(getModelToken(UserSession.name));
    assignments = app.get(getModelToken(ModeratorAssignment.name));
    countries = app.get(getModelToken(Country.name));
    cities = app.get(getModelToken(City.name));
    await Promise.all([
      hotels.init(),
      rooms.init(),
      availability.init(),
      bookings.init(),
      reviews.init(),
      users.init(),
      sessions.init(),
      assignments.init(),
      countries.init(),
      cities.init(),
    ]);
  }, 240000);

  afterAll(async () => {
    if (app) await app.close();
    if (mongo) await mongo.stop();
    if (uploadDir) await rm(uploadDir, { recursive: true, force: true });
  });

  async function actor(role: Role, providerId?: string) {
    const user = await users.create({
      email: `${randomUUID()}@example.test`,
      passwordHash: 'fixture-hash',
      firstName: 'Test',
      lastName: 'Traveler',
      role,
      status: AccountStatus.ACTIVE,
      isEmailVerified: true,
    });
    if (providerId)
      await assignments.create({
        moderator: user._id,
        providerType: ProviderType.HOTEL,
        hotel: providerId,
        assignedBy: user._id,
      });
    const jti = randomUUID();
    await sessions.create({
      user: user._id,
      jti,
      expiresAt: new Date(Date.now() + 3600000),
    });
    const jwt = app.get(JwtService);
    const token = await jwt.signAsync(
      { sub: user._id.toString(), email: user.email, role, jti },
      { expiresIn: '1h' },
    );
    return { id: user._id.toString(), cookie: `access_token=${token}` };
  }

  beforeEach(async () => {
    await Promise.all([
      hotels.deleteMany({}),
      rooms.deleteMany({}),
      availability.deleteMany({}),
      bookings.deleteMany({}),
      reviews.deleteMany({}),
      users.deleteMany({}),
      sessions.deleteMany({}),
      assignments.deleteMany({}),
      countries.deleteMany({}),
      cities.deleteMany({}),
      app.get<Model<AuditLog>>(getModelToken(AuditLog.name)).deleteMany({}),
    ]);
    const country = await countries.create({
      code: 'EG',
      name: 'Egypt',
      currencyCode: 'USD',
    });
    const otherCountry = await countries.create({
      code: 'GB',
      name: 'United Kingdom',
      currencyCode: 'GBP',
    });
    countryId = country._id.toString();
    otherCountryId = otherCountry._id.toString();
    const city = await cities.create({
      name: 'Cairo',
      country: country._id,
      countryCode: 'EG',
    });
    cityId = city._id.toString();
    const hotel = await hotels.create({
      name: 'Nile Hotel',
      address: '12 Nile Street',
      city: city._id,
      cityName: city.name,
      country: country._id,
      countryCode: country.code,
      starRating: 4,
      amenities: ['wifi', 'pool'],
    });
    hotelId = hotel._id.toString();
    const otherHotel = await hotels.create({
      name: 'Other Hotel',
      address: 'Other Street',
      city: city._id,
      cityName: city.name,
      country: country._id,
      countryCode: country.code,
    });
    otherHotelId = otherHotel._id.toString();
    const room = await rooms.create({
      hotel: hotel._id,
      name: 'Room 101',
      roomType: 'Double',
      numberOfBeds: 2,
      maxOccupancy: 2,
      basePricePerNight: 100,
      totalUnits: 2,
    });
    roomId = room._id.toString();
    startDate = jsonDate(10);
    endDate = jsonDate(13);
    const admin = await actor(Role.ADMIN);
    const moderator = await actor(Role.HOTEL_MODERATOR, hotelId);
    const otherModerator = await actor(Role.HOTEL_MODERATOR, otherHotelId);
    const traveler = await actor(Role.REGISTERED_USER);
    const stranger = await actor(Role.REGISTERED_USER);
    const airline = await actor(Role.AIRLINE_MODERATOR);
    adminCookie = admin.cookie;
    moderatorCookie = moderator.cookie;
    otherModeratorCookie = otherModerator.cookie;
    travelerId = traveler.id;
    travelerCookie = traveler.cookie;
    strangerId = stranger.id;
    strangerCookie = stranger.cookie;
    airlineCookie = airline.cookie;
  });

  async function seedAvailability(
    overrides: Partial<RoomAvailability> = {},
    selectedRoomId = roomId,
  ) {
    const room = await rooms.findById(selectedRoomId).orFail();
    return availability.insertMany(
      dateRange(startDate, endDate).map((date) => ({
        hotel: hotelId,
        room: selectedRoomId,
        date,
        totalUnits: room.totalUnits,
        ...overrides,
      })),
    );
  }

  async function seedBooking(overrides: Partial<HotelBooking> = {}) {
    return bookings.create({
      bookingReference: randomUUID().toUpperCase(),
      user: travelerId,
      hotel: hotelId,
      rooms: [
        {
          room: roomId,
          roomName: 'Room 101',
          quantity: 1,
          averagePricePerNight: 100,
          nights: 3,
          subtotal: 300,
        },
      ],
      checkInDate: startDate,
      checkOutDate: endDate,
      nights: 3,
      guestCount: 2,
      primaryGuestName: 'Test Traveler',
      primaryGuestEmail: 'traveler@example.test',
      totalPrice: 300,
      status: BookingStatus.CONFIRMED,
      ...overrides,
    });
  }

  async function seedReview(rating = 4, hidden = false) {
    const booking = await seedBooking({
      checkInDate: new Date(jsonDate(-5)),
      checkOutDate: new Date(jsonDate(-2)),
      status: BookingStatus.COMPLETED,
    });
    return reviews.create({
      hotel: hotelId,
      booking: booking._id,
      user: travelerId,
      rating,
      comment: 'Enjoyed the stay',
      isHidden: hidden,
    });
  }

  ticket('SCRUM-52', () => {
    it('casts all hotel, booking, review and authentication references as ObjectIds', async () => {
      for (const [model, field] of [
        [reviews, 'hotel'],
        [reviews, 'booking'],
        [availability, 'room'],
        [bookings, 'user'],
        [sessions, 'user'],
        [assignments, 'moderator'],
        [cities, 'country'],
      ] as const) {
        expect(model.schema.path(field).instance).toBe('ObjectId');
      }
      await seedReview();
      expect(
        await reviews.countDocuments({ hotel: hotelId, isHidden: false }),
      ).toBe(1);
    });
    it('creates a validated hotel as admin and derives city/country metadata', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/hotels')
        .set('Cookie', adminCookie)
        .send({
          name: ' New Hotel ',
          address: 'A street',
          city: cityId,
          country: countryId,
          starRating: 5,
          amenities: ['wifi'],
        })
        .expect(201);
      expect(body(response)).toMatchObject({
        name: 'New Hotel',
        city: cityId,
        country: countryId,
        cityName: 'Cairo',
        countryCode: 'EG',
        baseCurrency: 'USD',
        isActive: true,
      });
    });
    it('requires authentication and reserves creation for administrators', async () => {
      for (const cookie of [
        '',
        travelerCookie,
        moderatorCookie,
        airlineCookie,
      ]) {
        await request(app.getHttpServer())
          .post('/api/hotels')
          .set('Cookie', cookie)
          .send({ name: 'New Hotel', address: 'A street', city: cityId })
          .expect(cookie ? 403 : 401);
      }
    });
    it('rejects unknown fields, invalid reference data, mismatched countries and invalid stars', async () => {
      for (const overrides of [
        { city: new Types.ObjectId().toString() },
        { country: otherCountryId },
        { starRating: 6 },
        { starRating: null },
        { isActive: false },
        { baseCurrency: 'GBP' },
        { name: '' },
        { images: [null] },
      ]) {
        await request(app.getHttpServer())
          .post('/api/hotels')
          .set('Cookie', adminCookie)
          .send({
            name: 'New Hotel',
            address: 'A street',
            city: cityId,
            ...overrides,
          })
          .expect(400);
      }
    });
    it('keeps all assigned API routes and DTOs discoverable in Swagger', () => {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder()
          .setTitle('Hotel tests')
          .setVersion('1')
          .addCookieAuth('access_token')
          .build(),
      );
      expect(Object.keys(document.paths)).toEqual(
        expect.arrayContaining([
          '/api/hotels',
          '/api/hotels/search',
          '/api/hotels/{id}/rooms/{roomId}/availability',
          '/api/reviews/{id}/reply',
        ]),
      );
      expect(document.paths['/api/hotels'].post?.requestBody).toBeDefined();
      expect(document.components?.schemas?.HotelPoliciesDto).toBeDefined();
    });
  });

  ticket('SCRUM-53', () => {
    it('matches city, country and destination and requires all stay nights', async () => {
      await seedAvailability();
      for (const destination of [
        { city: cityId },
        { country: countryId },
        { destination: 'Egypt' },
        { destination: 'Cairo' },
      ]) {
        const response = await request(app.getHttpServer())
          .get('/api/hotels/search')
          .query({ ...stay(), ...destination })
          .expect(200);
        expect(
          body<Page<HotelView>>(response).data.map((hotel) => hotel._id),
        ).toEqual([hotelId]);
      }
      await availability.deleteOne({ room: roomId, date: new Date(startDate) });
      expect(
        body<Page<HotelView>>(
          await request(app.getHttpServer())
            .get('/api/hotels/search')
            .query({ ...stay(), city: cityId })
            .expect(200),
        ).total,
      ).toBe(0);
    });
    it('matches a multi-room allocation using combined occupancy and the requested unit count', async () => {
      await seedAvailability();
      const response = await request(app.getHttpServer())
        .get('/api/hotels/search')
        .query({ ...stay(), city: cityId, guestCount: 4, roomCount: 2 })
        .expect(200);
      expect(body<Page<HotelView>>(response).total).toBe(1);
      for (const criteria of [
        { guestCount: 5, roomCount: 2 },
        { guestCount: 2, roomCount: 3 },
      ]) {
        expect(
          body<Page<HotelView>>(
            await request(app.getHttpServer())
              .get('/api/hotels/search')
              .query({ ...stay(), city: cityId, ...criteria })
              .expect(200),
          ).total,
        ).toBe(0);
      }
    });
    it('excludes blocked, fully allocated, inactive rooms and inactive hotels', async () => {
      await seedAvailability({ heldUnits: 2 });
      const search = () =>
        request(app.getHttpServer())
          .get('/api/hotels/search')
          .query({ ...stay(), city: cityId })
          .expect(200);
      expect(body<Page<HotelView>>(await search()).total).toBe(0);
      await availability.updateMany({}, { heldUnits: 0, isBlocked: true });
      expect(body<Page<HotelView>>(await search()).total).toBe(0);
      await availability.updateMany({}, { isBlocked: false });
      await rooms.updateOne({ _id: roomId }, { isActive: false });
      expect(body<Page<HotelView>>(await search()).total).toBe(0);
      await rooms.updateOne({ _id: roomId }, { isActive: true });
      await hotels.updateOne({ _id: hotelId }, { isActive: false });
      expect(body<Page<HotelView>>(await search()).total).toBe(0);
    });
    it('filters inclusive nightly prices, minimum rating, amenities and stars with stable pagination', async () => {
      await seedAvailability({ priceOverride: 120 });
      await seedReview(4);
      await seedReview(1, true);
      const query = {
        ...stay(),
        city: cityId,
        minPrice: 120,
        maxPrice: 120,
        minRating: 4,
        amenities: 'wifi,pool',
        starRating: 4,
        sortBy: 'rating',
        sortOrder: 'desc',
        limit: 1,
      };
      const first = body<Page<HotelView>>(
        await request(app.getHttpServer())
          .get('/api/hotels/search')
          .query(query)
          .expect(200),
      );
      expect(first).toMatchObject({
        total: 1,
        limit: 1,
        data: [{ _id: hotelId, pricePerNight: 120, averageRating: 4 }],
      });
      expect(
        body<Page<HotelView>>(
          await request(app.getHttpServer())
            .get('/api/hotels/search')
            .query({ ...query, page: 2 })
            .expect(200),
        ).data,
      ).toEqual([]);
      for (const criteria of [
        { minRating: 5 },
        { minPrice: 121, maxPrice: 130 },
        { amenities: 'spa' },
        { starRating: 5 },
      ]) {
        expect(
          body<Page<HotelView>>(
            await request(app.getHttpServer())
              .get('/api/hotels/search')
              .query({ ...query, ...criteria })
              .expect(200),
          ).total,
        ).toBe(0);
      }
    });
    it('rejects reversed/past/invalid dates, bad filters, unknown fields and regex injection', async () => {
      for (const overrides of [
        { checkOutDate: startDate },
        { checkInDate: jsonDate(-1) },
        { checkInDate: '2027-02-30' },
        { checkInDate: '2027-01-01T12:00:00Z' },
        { minPrice: 200, maxPrice: 100 },
        { sortBy: '$where' },
        { limit: 101 },
        { roomCount: 0 },
        { city: 'bad' },
        { unexpected: true },
      ]) {
        await request(app.getHttpServer())
          .get('/api/hotels/search')
          .query({ ...stay(), city: cityId, ...overrides })
          .expect(400);
      }
      await request(app.getHttpServer())
        .get('/api/hotels/search')
        .query(stay())
        .expect(400);
      expect(
        body<Page<HotelView>>(
          await request(app.getHttpServer())
            .get('/api/hotels/search')
            .query({ ...stay(), destination: '.*' })
            .expect(200),
        ).total,
      ).toBe(0);
    });
  });

  ticket('SCRUM-54', () => {
    it('returns a public hotel profile, policies, active room summary and visible review statistics', async () => {
      await seedReview(5);
      await seedReview(1, true);
      const response = await request(app.getHttpServer())
        .get(hotelPath())
        .expect(200);
      expect(body(response)).toMatchObject({
        _id: hotelId,
        averageRating: 5,
        reviewCount: 1,
        policies: {
          checkInTime: '15:00',
          cancellationTiers: expect.any(Array) as unknown,
        },
        rooms: { total: 1 },
        reviews: { total: 1 },
      });
      expect(JSON.stringify(body(response))).not.toContain('passwordHash');
    });
    it('includes available rooms and computed stay prices when dates are provided', async () => {
      await seedAvailability();
      expect(
        body(
          await request(app.getHttpServer())
            .get(hotelPath())
            .query(stay())
            .expect(200),
        ),
      ).toMatchObject({
        availableRooms: { nights: 3, data: [{ totalStayPrice: 300 }] },
      });
      await request(app.getHttpServer())
        .get(hotelPath())
        .query({ checkInDate: startDate })
        .expect(400);
    });
    it('returns clean errors for malformed/missing/inactive hotels', async () => {
      await request(app.getHttpServer()).get('/api/hotels/invalid').expect(400);
      await request(app.getHttpServer())
        .get(`/api/hotels/${new Types.ObjectId().toString()}`)
        .expect(404);
      await hotels.updateOne({ _id: hotelId }, { isActive: false });
      await request(app.getHttpServer()).get(hotelPath()).expect(404);
    });
  });

  ticket('SCRUM-55', () => {
    it('allows assigned moderator/admin updates and derives location from reference data', async () => {
      expect(
        body(
          await request(app.getHttpServer())
            .patch(hotelPath())
            .set('Cookie', moderatorCookie)
            .send({ name: 'Updated Hotel', amenities: ['wifi'], city: cityId })
            .expect(200),
        ),
      ).toMatchObject({
        name: 'Updated Hotel',
        cityName: 'Cairo',
        countryCode: 'EG',
      });
      await request(app.getHttpServer())
        .patch(hotelPath())
        .set('Cookie', adminCookie)
        .send({ description: 'Updated by admin' })
        .expect(200);
    });
    it('rejects cross-hotel or unassigned moderators, travelers, sensitive fields, nulls and empty updates', async () => {
      const unassigned = await actor(Role.HOTEL_MODERATOR);
      for (const cookie of [
        otherModeratorCookie,
        unassigned.cookie,
        travelerCookie,
      ])
        await request(app.getHttpServer())
          .patch(hotelPath())
          .set('Cookie', cookie)
          .send({ name: 'Hijacked' })
          .expect(403);
      for (const update of [
        {},
        { country: otherCountryId },
        { averageRating: 5 },
        { isActive: false },
        { city: null },
        { name: null },
      ])
        await request(app.getHttpServer())
          .patch(hotelPath())
          .set('Cookie', moderatorCookie)
          .send(update)
          .expect(400);
    });
    it('stores photos, enforces file signatures and caps the combined image count at five', async () => {
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jPo8AAAAASUVORK5CYII=',
        'base64',
      );
      const response = await request(app.getHttpServer())
        .post(hotelPath('/images'))
        .set('Cookie', moderatorCookie)
        .attach('images', png, {
          filename: 'photo.png',
          contentType: 'image/png',
        })
        .expect(201);
      const images = body<{
        images: {
          url: string;
          filename: string;
          mimeType: string;
          sizeBytes: number;
        }[];
      }>(response).images;
      expect(images).toHaveLength(1);
      expect(await readdir(uploadDir)).toContain(images[0].filename);
      await request(app.getHttpServer())
        .patch(hotelPath())
        .set('Cookie', moderatorCookie)
        .send({ images })
        .expect(200);
      await request(app.getHttpServer())
        .post(hotelPath('/images'))
        .set('Cookie', moderatorCookie)
        .attach('images', Buffer.from('not a real image file'), {
          filename: 'fake.png',
          contentType: 'image/png',
        })
        .expect(400);
      for (let i = 0; i < 4; i++)
        await request(app.getHttpServer())
          .post(hotelPath('/images'))
          .set('Cookie', moderatorCookie)
          .attach('images', png, {
            filename: 'photo.png',
            contentType: 'image/png',
          })
          .expect(201);
      await request(app.getHttpServer())
        .post(hotelPath('/images'))
        .set('Cookie', moderatorCookie)
        .attach('images', png, {
          filename: 'photo.png',
          contentType: 'image/png',
        })
        .expect(409);
      await request(app.getHttpServer())
        .patch(hotelPath())
        .set('Cookie', moderatorCookie)
        .send({ images: [] })
        .expect(200);
    });
  });

  ticket('SCRUM-56', () => {
    it('creates a room with beds, capacity, price and hotel-scoped unique name', async () => {
      expect(
        body(
          await request(app.getHttpServer())
            .post(hotelPath('/rooms'))
            .set('Cookie', moderatorCookie)
            .send(newRoom())
            .expect(201),
        ),
      ).toMatchObject({
        hotel: hotelId,
        numberOfBeds: 2,
        basePricePerNight: 80,
        currency: 'USD',
      });
      await request(app.getHttpServer())
        .post(hotelPath('/rooms'))
        .set('Cookie', moderatorCookie)
        .send(newRoom())
        .expect(409);
      await request(app.getHttpServer())
        .post(`/api/hotels/${otherHotelId}/rooms`)
        .set('Cookie', adminCookie)
        .send(newRoom())
        .expect(201);
    });
    it('validates positive prices/beds, whole capacities, unit counts and assignment', async () => {
      for (const overrides of [
        { basePricePerNight: 0 },
        { numberOfBeds: 0 },
        { maxOccupancy: 1.5 },
        { totalUnits: 0 },
        { maxAdults: 3 },
        { currency: 'GBP' },
        { name: ' ' },
        { hotel: otherHotelId },
      ])
        await request(app.getHttpServer())
          .post(hotelPath('/rooms'))
          .set('Cookie', moderatorCookie)
          .send({ ...newRoom(), ...overrides })
          .expect(400);
      await request(app.getHttpServer())
        .post(hotelPath('/rooms'))
        .set('Cookie', otherModeratorCookie)
        .send(newRoom())
        .expect(403);
    });
  });

  ticket('SCRUM-57', () => {
    it('updates room price/details without changing stored reservation prices', async () => {
      const booking = await seedBooking();
      expect(
        body(
          await request(app.getHttpServer())
            .patch(roomPath())
            .set('Cookie', moderatorCookie)
            .send({ basePricePerNight: 150, numberOfBeds: 3 })
            .expect(200),
        ),
      ).toMatchObject({ basePricePerNight: 150, numberOfBeds: 3 });
      expect((await bookings.findById(booking._id).orFail()).totalPrice).toBe(
        300,
      );
    });
    it('requires hotel ownership and verifies the room belongs to the hotel', async () => {
      await request(app.getHttpServer())
        .patch(roomPath())
        .set('Cookie', otherModeratorCookie)
        .send({ name: 'No' })
        .expect(403);
      await request(app.getHttpServer())
        .patch(`/api/hotels/${otherHotelId}/rooms/${roomId}`)
        .set('Cookie', adminCookie)
        .send({ name: 'No' })
        .expect(404);
      await request(app.getHttpServer())
        .patch(hotelPath('/rooms/bad'))
        .set('Cookie', moderatorCookie)
        .send({ name: 'No' })
        .expect(400);
    });
    it('rejects capacity reductions/deactivation that conflict with bookings or holds', async () => {
      await seedAvailability({ bookedUnits: 1, heldUnits: 1 });
      await request(app.getHttpServer())
        .patch(roomPath())
        .set('Cookie', moderatorCookie)
        .send({ totalUnits: 1 })
        .expect(409);
      await request(app.getHttpServer())
        .patch(roomPath())
        .set('Cookie', moderatorCookie)
        .send({ isActive: false })
        .expect(409);
      for (const update of [
        { isActive: 'false' },
        { isActive: null },
        { maxOccupancy: null },
        {},
      ])
        await request(app.getHttpServer())
          .patch(roomPath())
          .set('Cookie', moderatorCookie)
          .send(update)
          .expect(400);
      await availability.updateMany({}, { bookedUnits: 0, heldUnits: 0 });
      await request(app.getHttpServer())
        .patch(roomPath())
        .set('Cookie', moderatorCookie)
        .send({ totalUnits: 1 })
        .expect(200);
      expect(
        (await availability.findOne({ room: roomId }).orFail()).totalUnits,
      ).toBe(1);
    });
  });

  ticket('SCRUM-58', () => {
    it('hard-deletes only never-reserved rooms and cleans their availability', async () => {
      await seedAvailability();
      expect(
        body(
          await request(app.getHttpServer())
            .delete(roomPath())
            .set('Cookie', moderatorCookie)
            .expect(200),
        ),
      ).toMatchObject({ deleted: true, deactivated: false });
      expect(await rooms.findById(roomId)).toBeNull();
      expect(await availability.countDocuments({ room: roomId })).toBe(0);
    });
    it('soft-deactivates a historically reserved room and preserves historical bookings', async () => {
      const booking = await seedBooking({
        checkInDate: new Date(jsonDate(-5)),
        checkOutDate: new Date(jsonDate(-2)),
        status: BookingStatus.COMPLETED,
      });
      await seedAvailability();
      expect(
        body(
          await request(app.getHttpServer())
            .delete(roomPath())
            .set('Cookie', moderatorCookie)
            .expect(200),
        ),
      ).toMatchObject({ deleted: false, deactivated: true });
      expect((await rooms.findById(roomId).orFail()).isActive).toBe(false);
      expect(await bookings.findById(booking._id)).not.toBeNull();
    });
    it.each([
      BookingStatus.CONFIRMED,
      BookingStatus.PENDING_PAYMENT,
      BookingStatus.HELD,
    ])(
      'protects overlapping %s reservations even if counters are missing',
      async (status) => {
        await seedBooking({
          status,
          holdExpiresAt: new Date(Date.now() + 600000),
        });
        await request(app.getHttpServer())
          .delete(roomPath())
          .set('Cookie', moderatorCookie)
          .expect(409);
        expect(await rooms.findById(roomId)).not.toBeNull();
      },
    );
    it('rejects another hotel moderator', async () => {
      await request(app.getHttpServer())
        .delete(roomPath())
        .set('Cookie', otherModeratorCookie)
        .expect(403);
    });
  });

  ticket('SCRUM-59', () => {
    it('returns minimum free units and the sum of nightly prices for the half-open stay', async () => {
      await seedAvailability({ heldUnits: 1 });
      await availability.updateOne(
        { room: roomId, date: new Date(startDate) },
        { priceOverride: 130 },
      );
      await availability.create({
        hotel: hotelId,
        room: roomId,
        date: new Date(endDate),
        totalUnits: 0,
        isBlocked: true,
      });
      const response = await request(app.getHttpServer())
        .get(hotelPath('/rooms/available'))
        .query(stay())
        .expect(200);
      expect(body<Page<RoomView>>(response)).toMatchObject({
        total: 1,
        data: [
          {
            _id: roomId,
            minimumAvailableUnits: 1,
            totalStayPrice: 330,
            averagePricePerNight: 110,
            numberOfBeds: 2,
          },
        ],
      });
    });
    it('omits rooms with missing or blocked stay nights', async () => {
      await seedAvailability();
      await availability.updateOne(
        { room: roomId, date: new Date(startDate) },
        { isBlocked: true },
      );
      expect(
        body<Page<RoomView>>(
          await request(app.getHttpServer())
            .get(hotelPath('/rooms/available'))
            .query(stay())
            .expect(200),
        ).total,
      ).toBe(0);
      await availability.updateMany({}, { isBlocked: false });
      await availability.deleteOne({ room: roomId });
      expect(
        body<Page<RoomView>>(
          await request(app.getHttpServer())
            .get(hotelPath('/rooms/available'))
            .query(stay())
            .expect(200),
        ).total,
      ).toBe(0);
    });
    it('returns small rooms for combined selection and paginates available rooms', async () => {
      await seedAvailability();
      const second = await rooms.create({ hotel: hotelId, ...newRoom() });
      await seedAvailability({}, second._id.toString());
      const response = await request(app.getHttpServer())
        .get(hotelPath('/rooms/available'))
        .query({ ...stay(), guestCount: 4, limit: 1 })
        .expect(200);
      expect(body<Page<RoomView>>(response)).toMatchObject({
        total: 2,
        limit: 1,
        totalPages: 2,
      });
    });
  });

  ticket('SCRUM-60', () => {
    it('initializes each night at UTC midnight and excludes endDate', async () => {
      await request(app.getHttpServer())
        .post(roomPath('/availability'))
        .set('Cookie', moderatorCookie)
        .send({ ...range(), totalUnits: 2, priceOverride: 99 })
        .expect(201);
      const rows = await availability
        .find({ room: roomId })
        .sort({ date: 1 })
        .lean();
      expect(rows).toHaveLength(3);
      expect(rows.map((row) => row.date.toISOString())).toEqual(
        [startDate, jsonDate(11), jsonDate(12)].map(
          (date) => `${date}T00:00:00.000Z`,
        ),
      );
      expect(
        rows.every(
          (row) =>
            row.heldUnits === 0 &&
            row.bookedUnits === 0 &&
            row.priceOverride === 99,
        ),
      ).toBe(true);
    });
    it('rejects overlapping ranges atomically without inserting their nonoverlapping nights', async () => {
      await seedAvailability({ bookedUnits: 1 });
      await request(app.getHttpServer())
        .post(roomPath('/availability'))
        .set('Cookie', moderatorCookie)
        .send({ startDate: jsonDate(9), endDate: jsonDate(11), totalUnits: 1 })
        .expect(409);
      expect(await availability.countDocuments({ room: roomId })).toBe(3);
      expect(
        await availability.findOne({
          room: roomId,
          date: new Date(jsonDate(9)),
        }),
      ).toBeNull();
    });
    it('allows adjacent ranges and rejects invalid totals, null/string booleans or unauthorized owners', async () => {
      await seedAvailability();
      await request(app.getHttpServer())
        .post(roomPath('/availability'))
        .set('Cookie', moderatorCookie)
        .send({ startDate: endDate, endDate: jsonDate(14) })
        .expect(201);
      for (const overrides of [
        { totalUnits: 3 },
        { isBlocked: 'false' },
        { isBlocked: null },
        { endDate: startDate },
      ])
        await request(app.getHttpServer())
          .post(roomPath('/availability'))
          .set('Cookie', moderatorCookie)
          .send({ ...range(), ...overrides })
          .expect(400);
      await request(app.getHttpServer())
        .post(roomPath('/availability'))
        .set('Cookie', otherModeratorCookie)
        .send(range())
        .expect(403);
    });
    it('serializes simultaneous initialization of the same range', async () => {
      const results = await Promise.all(
        Array.from({ length: 2 }, () =>
          request(app.getHttpServer())
            .post(roomPath('/availability'))
            .set('Cookie', moderatorCookie)
            .send(range()),
        ),
      );
      expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
      expect(await availability.countDocuments({ room: roomId })).toBe(3);
    });
  });

  ticket('SCRUM-61', () => {
    it('updates nightly prices, blocks/unblocks unused dates and restores base pricing with null', async () => {
      await seedAvailability();
      await request(app.getHttpServer())
        .patch(roomPath('/availability'))
        .set('Cookie', moderatorCookie)
        .send({
          ...range(),
          priceOverride: 125,
          isBlocked: true,
          blockReason: 'Maintenance',
        })
        .expect(200);
      expect(
        (await availability.findOne({ room: roomId }).orFail()).isBlocked,
      ).toBe(true);
      await request(app.getHttpServer())
        .patch(roomPath('/availability'))
        .set('Cookie', moderatorCookie)
        .send({ ...range(), priceOverride: null, isBlocked: false })
        .expect(200);
      expect(await availability.findOne({ room: roomId }).lean()).toMatchObject(
        { priceOverride: null, isBlocked: false, blockReason: '' },
      );
    });
    it('rejects below-allocation totals and applies no partial changes across the range', async () => {
      await seedAvailability();
      await availability.updateOne(
        { room: roomId, date: new Date(jsonDate(11)) },
        { bookedUnits: 1, heldUnits: 1 },
      );
      await request(app.getHttpServer())
        .patch(roomPath('/availability'))
        .set('Cookie', moderatorCookie)
        .send({ ...range(), totalUnits: 1, priceOverride: 50 })
        .expect(409);
      expect(
        await availability.countDocuments({
          room: roomId,
          totalUnits: 2,
          priceOverride: null,
        }),
      ).toBe(3);
    });
    it.each([
      BookingStatus.CONFIRMED,
      BookingStatus.PENDING_PAYMENT,
      BookingStatus.HELD,
    ])('rejects blocking dates with a %s reservation', async (status) => {
      await seedAvailability();
      await seedBooking({
        status,
        holdExpiresAt: new Date(Date.now() + 600000),
      });
      await request(app.getHttpServer())
        .patch(roomPath('/availability'))
        .set('Cookie', moderatorCookie)
        .send({ ...range(), isBlocked: true })
        .expect(409);
      expect(await availability.countDocuments({ isBlocked: true })).toBe(0);
    });
    it('requires initialized dates and actual changes', async () => {
      await request(app.getHttpServer())
        .patch(roomPath('/availability'))
        .set('Cookie', moderatorCookie)
        .send({ ...range(), priceOverride: 50 })
        .expect(409);
      await seedAvailability();
      await request(app.getHttpServer())
        .patch(roomPath('/availability'))
        .set('Cookie', moderatorCookie)
        .send(range())
        .expect(400);
      await request(app.getHttpServer())
        .patch(roomPath('/availability'))
        .set('Cookie', otherModeratorCookie)
        .send({ ...range(), priceOverride: 50 })
        .expect(403);
    });
    it('does not lose a concurrent atomic hold when reducing nightly capacity', async () => {
      await seedAvailability();
      await Promise.all([
        request(app.getHttpServer())
          .patch(roomPath('/availability'))
          .set('Cookie', moderatorCookie)
          .send({ ...range(), totalUnits: 1 }),
        availability.updateOne(
          {
            room: roomId,
            date: new Date(startDate),
            isBlocked: false,
            $expr: {
              $lte: [
                { $add: ['$bookedUnits', '$heldUnits', 2] },
                '$totalUnits',
              ],
            },
          },
          { $inc: { heldUnits: 2 } },
        ),
      ]);
      const rows = await availability.find({ room: roomId }).lean();
      expect(
        rows.every((row) => row.bookedUnits + row.heldUnits <= row.totalUnits),
      ).toBe(true);
    });
  });

  ticket('SCRUM-62', () => {
    it('returns a per-room nightly public matrix and marks missing dates unavailable', async () => {
      await seedAvailability();
      await availability.updateOne(
        { room: roomId, date: new Date(jsonDate(11)) },
        { isBlocked: true, blockReason: 'Private maintenance note' },
      );
      const response = await request(app.getHttpServer())
        .get(hotelPath('/availability'))
        .query({ startDate, endDate: jsonDate(14) })
        .expect(200);
      expect(body(response)).toMatchObject({
        rooms: [
          {
            roomId,
            dates: [
              { status: 'Available' },
              { status: 'Blocked' },
              { status: 'Available' },
              { status: 'Unavailable' },
            ],
          },
        ],
      });
      expect(JSON.stringify(body(response))).not.toContain(
        'Private maintenance note',
      );
      expect(JSON.stringify(body(response))).not.toContain('reservations');
    });
    it('shows reservation references only to the assigned moderator or admin', async () => {
      await seedAvailability({ bookedUnits: 2 });
      const booking = await seedBooking();
      const response = await request(app.getHttpServer())
        .get(hotelPath('/availability/management'))
        .set('Cookie', moderatorCookie)
        .query(range())
        .expect(200);
      expect(JSON.stringify(body(response))).toContain(
        booking.bookingReference,
      );
      await request(app.getHttpServer())
        .get(hotelPath('/availability/management'))
        .set('Cookie', otherModeratorCookie)
        .query(range())
        .expect(403);
      const publicResponse = await request(app.getHttpServer())
        .get(hotelPath('/availability'))
        .query(range())
        .expect(200);
      expect(JSON.stringify(body(publicResponse))).not.toContain(
        booking.bookingReference,
      );
    });
  });

  ticket('SCRUM-63', () => {
    const policies = () => ({
      checkInTime: '14:00',
      checkOutTime: '10:00',
      allowCancellation: true,
      freeCancellationDaysBeforeCheckIn: 3,
      cancellationFeePercentage: 25,
      childrenAllowed: true,
      petsAllowed: false,
      smokingAllowed: false,
      termsText: 'Quiet after 22:00',
      cancellationTiers: [
        { daysBeforeCheckIn: 0, refundPercentage: 25 },
        { daysBeforeCheckIn: 3, refundPercentage: 100 },
      ],
    });
    it('replaces validated policy terms and cancellation tiers without mutating booking snapshots', async () => {
      const snapshot = {
        checkInTime: '15:00',
        cancellationTiers: [{ daysBeforeCheckIn: 0, refundPercentage: 50 }],
      };
      const booking = await seedBooking({ policySnapshot: snapshot });
      expect(
        body(
          await request(app.getHttpServer())
            .put(hotelPath('/policies'))
            .set('Cookie', moderatorCookie)
            .send(policies())
            .expect(200),
        ),
      ).toMatchObject({ policies: policies() });
      expect(
        (await bookings.findById(booking._id).orFail()).policySnapshot,
      ).toEqual(snapshot);
    });
    it('validates clock values, unique thresholds, percentages, house rules and real booleans', async () => {
      for (const overrides of [
        { checkInTime: '24:00' },
        { checkOutTime: '9am' },
        { allowCancellation: 'false' },
        { allowCancellation: null },
        { petsAllowed: 'false' },
        { cancellationFeePercentage: 101 },
        { freeCancellationDaysBeforeCheckIn: -1 },
        {
          cancellationTiers: [
            { daysBeforeCheckIn: 0, refundPercentage: 50 },
            { daysBeforeCheckIn: 0, refundPercentage: 100 },
          ],
        },
        { cancellationTiers: [null] },
      ])
        await request(app.getHttpServer())
          .put(hotelPath('/policies'))
          .set('Cookie', moderatorCookie)
          .send({ ...policies(), ...overrides })
          .expect(400);
      await request(app.getHttpServer())
        .put(hotelPath('/policies'))
        .set('Cookie', otherModeratorCookie)
        .send(policies())
        .expect(403);
    });
  });

  ticket('SCRUM-64', () => {
    it('returns only hotel-scoped reservations with status, overlap dates and pagination', async () => {
      const booking = await seedBooking();
      await seedBooking({ status: BookingStatus.CANCELLED });
      await seedBooking({ hotel: new Types.ObjectId(otherHotelId) });
      const response = await request(app.getHttpServer())
        .get(hotelPath('/reservations'))
        .set('Cookie', moderatorCookie)
        .query({
          status: BookingStatus.CONFIRMED,
          startDate,
          endDate,
          page: 1,
          limit: 1,
        })
        .expect(200);
      expect(body(response)).toMatchObject({
        total: 1,
        data: [
          {
            _id: booking._id.toString(),
            primaryGuestName: 'Test Traveler',
            status: BookingStatus.CONFIRMED,
          },
        ],
      });
      expect(JSON.stringify(body(response))).not.toContain('policySnapshot');
      expect(
        body<Page<unknown>>(
          await request(app.getHttpServer())
            .get(hotelPath('/reservations'))
            .set('Cookie', moderatorCookie)
            .query({ startDate: endDate })
            .expect(200),
        ).total,
      ).toBe(0);
    });
    it('enforces ownership and rejects invalid filters/sort fields', async () => {
      for (const cookie of [otherModeratorCookie, travelerCookie])
        await request(app.getHttpServer())
          .get(hotelPath('/reservations'))
          .set('Cookie', cookie)
          .expect(403);
      for (const query of [
        { status: 'OTHER' },
        { sortBy: 'user.passwordHash' },
        { startDate: '2027-02-30' },
        { startDate: endDate, endDate: startDate },
      ])
        await request(app.getHttpServer())
          .get(hotelPath('/reservations'))
          .set('Cookie', moderatorCookie)
          .query(query)
          .expect(400);
    });
  });

  ticket('SCRUM-65', () => {
    it('paginates newest visible reviews with ratings, breakdown and safe author/reply fields', async () => {
      const old = await seedReview(3);
      await reviews.updateOne(
        { _id: old._id },
        { createdAt: new Date(Date.now() - 60000) },
      );
      await seedReview(5);
      await seedReview(1, true);
      const response = await request(app.getHttpServer())
        .get(hotelPath('/reviews'))
        .query({ limit: 1 })
        .expect(200);
      expect(body<ReviewPage>(response)).toMatchObject({
        total: 2,
        averageRating: 4,
        reviewCount: 2,
        ratingBreakdown: { '1': 0, '3': 1, '5': 1 },
        data: [{ rating: 5, authorName: 'Test Traveler' }],
      });
      for (const field of [
        'passwordHash',
        'primaryGuestEmail',
        'booking',
        'user',
        'repliedBy',
      ])
        expect(JSON.stringify(body(response))).not.toContain(`"${field}"`);
      await users.updateOne(
        { _id: travelerId },
        { status: AccountStatus.DEACTIVATED },
      );
      expect(
        body<ReviewPage>(
          await request(app.getHttpServer())
            .get(hotelPath('/reviews'))
            .expect(200),
        ).data[0].authorName,
      ).toBe('Deleted user');
    });
    it('provides an empty state with zero rating after hidden/unreviewed stays', async () => {
      await seedReview(2, true);
      expect(
        body(
          await request(app.getHttpServer())
            .get(hotelPath('/reviews'))
            .expect(200),
        ),
      ).toMatchObject({ data: [], total: 0, averageRating: 0, reviewCount: 0 });
    });
  });

  ticket('SCRUM-66', () => {
    it('creates one optional-text rating per completed owned booking and refreshes hotel totals', async () => {
      const booking = await seedBooking({
        checkInDate: new Date(jsonDate(-5)),
        checkOutDate: new Date(jsonDate(-2)),
        status: BookingStatus.CONFIRMED,
      });
      const url = `/api/hotel-bookings/${booking._id.toString()}/review`;
      expect(
        body(
          await request(app.getHttpServer())
            .post(url)
            .set('Cookie', travelerCookie)
            .send({ rating: 5 })
            .expect(201),
        ),
      ).toMatchObject({ rating: 5, comment: '', hotel: hotelId });
      expect(await hotels.findById(hotelId).lean()).toMatchObject({
        averageRating: 5,
        reviewCount: 1,
      });
      expect((await bookings.findById(booking._id).orFail()).status).toBe(
        BookingStatus.COMPLETED,
      );
      await request(app.getHttpServer())
        .post(url)
        .set('Cookie', travelerCookie)
        .send({ rating: 4 })
        .expect(409);
    });
    it('rejects other owners, unpaid/cancelled stays, early reviews and invalid content', async () => {
      const booking = await seedBooking();
      const url = `/api/hotel-bookings/${booking._id.toString()}/review`;
      await request(app.getHttpServer())
        .post(url)
        .set('Cookie', strangerCookie)
        .send({ rating: 4 })
        .expect(403);
      await request(app.getHttpServer())
        .post(url)
        .set('Cookie', travelerCookie)
        .send({ rating: 4 })
        .expect(400);
      await bookings.updateOne(
        { _id: booking._id },
        {
          checkInDate: jsonDate(-5),
          checkOutDate: jsonDate(-2),
          status: BookingStatus.CANCELLED,
        },
      );
      await request(app.getHttpServer())
        .post(url)
        .set('Cookie', travelerCookie)
        .send({ rating: 4 })
        .expect(400);
      for (const update of [
        { rating: 6 },
        { rating: 2.5 },
        { rating: 4, comment: 'x'.repeat(1001) },
        { rating: 4, isHidden: true },
      ])
        await request(app.getHttpServer())
          .post(url)
          .set('Cookie', travelerCookie)
          .send(update)
          .expect(400);
    });
    it('prevents duplicate concurrent reviews with the unique booking index', async () => {
      const booking = await seedBooking({
        checkInDate: new Date(jsonDate(-5)),
        checkOutDate: new Date(jsonDate(-2)),
        status: BookingStatus.COMPLETED,
      });
      const results = await Promise.all(
        Array.from({ length: 2 }, () =>
          request(app.getHttpServer())
            .post(`/api/hotel-bookings/${booking._id.toString()}/review`)
            .set('Cookie', travelerCookie)
            .send({ rating: 5 }),
        ),
      );
      expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
      expect(await reviews.countDocuments({ booking: booking._id })).toBe(1);
      expect(await hotels.findById(hotelId).lean()).toMatchObject({
        averageRating: 5,
        reviewCount: 1,
      });
    });
    it('serializes rating updates across concurrent reviews of different bookings', async () => {
      const completed = {
        checkInDate: new Date(jsonDate(-5)),
        checkOutDate: new Date(jsonDate(-2)),
        status: BookingStatus.COMPLETED,
      };
      const first = await seedBooking(completed);
      const second = await seedBooking(completed);
      const results = await Promise.all(
        [1, 5].map((rating, index) =>
          request(app.getHttpServer())
            .post(
              `/api/hotel-bookings/${[first, second][index]._id.toString()}/review`,
            )
            .set('Cookie', travelerCookie)
            .send({ rating }),
        ),
      );
      expect(results.map((result) => result.status)).toEqual([201, 201]);
      expect(await hotels.findById(hotelId).lean()).toMatchObject({
        averageRating: 3,
        reviewCount: 2,
      });
    });
    it('marks only checked-out confirmed reservations completed during scheduled maintenance', async () => {
      const past = await seedBooking({
        checkInDate: new Date(jsonDate(-5)),
        checkOutDate: new Date(jsonDate(-2)),
      });
      const future = await seedBooking();
      const cancelled = await seedBooking({
        checkInDate: new Date(jsonDate(-5)),
        checkOutDate: new Date(jsonDate(-2)),
        status: BookingStatus.CANCELLED,
      });
      await app.get(HotelReviewsService).completeStays();
      expect((await bookings.findById(past._id).orFail()).status).toBe(
        BookingStatus.COMPLETED,
      );
      expect((await bookings.findById(future._id).orFail()).status).toBe(
        BookingStatus.CONFIRMED,
      );
      expect((await bookings.findById(cancelled._id).orFail()).status).toBe(
        BookingStatus.CANCELLED,
      );
    });
  });

  ticket('SCRUM-67', () => {
    it('lets an author edit their rating/title/comment and recalculates the hotel average', async () => {
      const review = await seedReview(2);
      await seedReview(4);
      expect(
        body(
          await request(app.getHttpServer())
            .patch(`/api/reviews/${review._id.toString()}`)
            .set('Cookie', travelerCookie)
            .send({ rating: 5, title: 'Updated', comment: 'Better after all' })
            .expect(200),
        ),
      ).toMatchObject({
        rating: 5,
        title: 'Updated',
        comment: 'Better after all',
      });
      expect(await hotels.findById(hotelId).lean()).toMatchObject({
        averageRating: 4.5,
        reviewCount: 2,
      });
    });
    it('rejects other users/admin edits, mass assignment, null ratings and empty updates', async () => {
      const review = await seedReview();
      const url = `/api/reviews/${review._id.toString()}`;
      await request(app.getHttpServer())
        .patch(url)
        .set('Cookie', strangerCookie)
        .send({ rating: 1 })
        .expect(403);
      await request(app.getHttpServer())
        .patch(url)
        .set('Cookie', adminCookie)
        .send({ rating: 1 })
        .expect(403);
      for (const update of [
        {},
        { rating: null },
        { user: strangerId },
        { comment: 'x'.repeat(1001) },
      ])
        await request(app.getHttpServer())
          .patch(url)
          .set('Cookie', travelerCookie)
          .send(update)
          .expect(400);
    });
    it('keeps hidden reviews excluded from hotel ratings after an edit', async () => {
      const hidden = await seedReview(1, true);
      await seedReview(4);
      await request(app.getHttpServer())
        .patch(`/api/reviews/${hidden._id.toString()}`)
        .set('Cookie', travelerCookie)
        .send({ rating: 5 })
        .expect(200);
      expect(await hotels.findById(hotelId).lean()).toMatchObject({
        averageRating: 4,
        reviewCount: 1,
      });
    });
  });

  ticket('SCRUM-68', () => {
    it('lets the author remove a review and resets an empty hotel rating to zero', async () => {
      const review = await seedReview(5);
      await request(app.getHttpServer())
        .delete(`/api/reviews/${review._id.toString()}`)
        .set('Cookie', travelerCookie)
        .expect(200);
      expect(await reviews.findById(review._id)).toBeNull();
      expect(await hotels.findById(hotelId).lean()).toMatchObject({
        averageRating: 0,
        reviewCount: 0,
      });
    });
    it('allows admin moderation with an audit entry, but rejects strangers', async () => {
      const review = await seedReview();
      const url = `/api/reviews/${review._id.toString()}`;
      await request(app.getHttpServer())
        .delete(url)
        .set('Cookie', strangerCookie)
        .expect(403);
      await request(app.getHttpServer())
        .delete(url)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(
        await app
          .get<Model<AuditLog>>(getModelToken(AuditLog.name))
          .findOne({ targetId: review._id.toString() })
          .lean(),
      ).toMatchObject({ action: 'CONTENT_DELETED', targetType: 'Review' });
      await request(app.getHttpServer())
        .delete(url)
        .set('Cookie', adminCookie)
        .expect(404);
    });
  });

  ticket('SCRUM-69', () => {
    it('lets the assigned moderator/admin reply and exposes a sanitized public reply', async () => {
      const review = await seedReview();
      const url = `/api/reviews/${review._id.toString()}/reply`;
      expect(
        body(
          await request(app.getHttpServer())
            .post(url)
            .set('Cookie', moderatorCookie)
            .send({ replyText: ' Thank you! ' })
            .expect(201),
        ),
      ).toMatchObject({
        moderatorReply: {
          replyText: 'Thank you!',
          repliedAt: expect.any(String) as unknown,
          repliedBy: expect.any(String) as unknown,
        },
      });
      await request(app.getHttpServer())
        .post(url)
        .set('Cookie', adminCookie)
        .send({ replyText: 'Updated reply' })
        .expect(201);
      expect(
        body<ReviewPage>(
          await request(app.getHttpServer())
            .get(hotelPath('/reviews'))
            .expect(200),
        ).data[0].moderatorReply,
      ).toEqual({
        replyText: 'Updated reply',
        repliedAt: expect.any(String) as unknown,
      });
    });
    it('rejects replies from travelers, other hotel moderators, hidden reviews and empty text', async () => {
      const review = await seedReview();
      const url = `/api/reviews/${review._id.toString()}/reply`;
      for (const cookie of [travelerCookie, otherModeratorCookie])
        await request(app.getHttpServer())
          .post(url)
          .set('Cookie', cookie)
          .send({ replyText: 'No' })
          .expect(403);
      for (const replyText of ['', ' ', 'x'.repeat(1001)])
        await request(app.getHttpServer())
          .post(url)
          .set('Cookie', moderatorCookie)
          .send({ replyText })
          .expect(400);
      await reviews.updateOne({ _id: review._id }, { isHidden: true });
      await request(app.getHttpServer())
        .post(url)
        .set('Cookie', moderatorCookie)
        .send({ replyText: 'No' })
        .expect(404);
    });
    it('rejects revoked and suspended sessions across protected hotel routes', async () => {
      await sessions.updateMany({}, { revokedAt: new Date() });
      await request(app.getHttpServer())
        .patch(hotelPath())
        .set('Cookie', moderatorCookie)
        .send({ name: 'No' })
        .expect(401);
      const suspended = await actor(Role.HOTEL_MODERATOR, hotelId);
      await users.updateOne(
        { _id: suspended.id },
        { status: AccountStatus.SUSPENDED },
      );
      await request(app.getHttpServer())
        .patch(hotelPath())
        .set('Cookie', suspended.cookie)
        .send({ name: 'No' })
        .expect(401);
    });
  });
});
