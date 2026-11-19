import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AxiosHeaders } from 'axios';
import type { Request } from 'express';
import type { Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as os from 'node:os';
import * as path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import { of, throwError } from 'rxjs';
import request from 'supertest';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { OPTIONAL_AUTH_KEY } from '../../common/decorators/optional-auth.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  BookingStatus,
  BookingType,
  BudgetCategory,
  ItineraryVisibility,
  Role,
  TransportMode,
} from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { User, UserSchema } from '../users/schemas/user.schema';
import { ItinerariesModule } from './itineraries.module';
import { ItinerariesService } from './itineraries.service';

/** Real models and HTTP validation; authentication uses explicit test identities. */
describe('Itinerary endpoints and persistence', () => {
  jest.setTimeout(180_000);
  let replset: MongoMemoryReplSet;
  let app: INestApplication;
  let db: Connection;
  let service: ItinerariesService;
  let reference: ReferenceDataService;
  let http: HttpService;
  let directory: string;
  const ownerId = new Types.ObjectId().toString();
  const otherId = new Types.ObjectId().toString();
  const user: AuthenticatedUser = {
    userId: ownerId,
    email: 'owner@example.test',
    role: Role.REGISTERED_USER,
    jti: 'integration-session',
  };
  const stranger: AuthenticatedUser = { ...user, userId: otherId };
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=',
    'base64',
  );

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'passportly-itineraries-'));
    replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          ignoreEnvVars: true,
          load: [
            () => ({ uploads: { dir: directory, maxImageSizeBytes: 1024 } }),
          ],
        }),
        MongooseModule.forRoot(replset.getUri(), {
          // MongoDB driver 7.6+ dynamically imports os, which Jest's VM cannot
          // resolve without experimental VM modules. Keep the workaround in tests.
          runtimeAdapters: { os },
          serverSelectionTimeoutMS: 5_000,
          retryAttempts: 0,
        }),
        ItinerariesModule,
      ],
    }).compile();
    service = module.get(ItinerariesService);
    reference = module.get(ReferenceDataService);
    http = module.get(HttpService);
    db = module.get<Connection>(getConnectionToken());
    db.model(User.name, UserSchema);
    await Promise.all(Object.values(db.models).map((model) => model.init()));
    const reflector = module.get(Reflector);
    const testAuth: CanActivate = {
      canActivate(context: ExecutionContext): boolean {
        const req = context
          .switchToHttp()
          .getRequest<Request & { user?: AuthenticatedUser }>();
        const identity = req.header('x-test-user');
        if (identity) req.user = identity === ownerId ? user : stranger;
        const publicRoute = reflector.getAllAndOverride<boolean>(
          IS_PUBLIC_KEY,
          [context.getHandler(), context.getClass()],
        );
        const optionalRoute = reflector.getAllAndOverride<boolean>(
          OPTIONAL_AUTH_KEY,
          [context.getHandler(), context.getClass()],
        );
        if (!req.user && !publicRoute && !optionalRoute)
          throw new UnauthorizedException();
        return true;
      },
    };
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalGuards(testAuth, new RolesGuard(reflector));
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Passportly test API').build(),
    );
    SwaggerModule.setup('api/docs', app, document);
    await app.init();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await Promise.all(
      Object.values(db.collections).map((collection) =>
        collection.deleteMany({}),
      ),
    );
    await reference.countryModel.create([
      { code: 'US', name: 'United States', currencyCode: 'USD' },
      { code: 'FR', name: 'France', currencyCode: 'EUR' },
    ]);
    await db.model<User>(User.name).create({
      _id: ownerId,
      email: user.email,
      passwordHash: 'test-fixture-hash',
      firstName: 'Owner',
      lastName: 'Traveler',
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    if (replset) await replset.stop();
    if (directory && path.dirname(directory) === path.resolve(tmpdir())) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  const server = (): Server => app.getHttpServer<Server>() as Server;
  const create = () =>
    service.createItinerary(ownerId, {
      title: 'Test trip',
      startDate: '2027-06-15',
    });
  const addDay = (id: string) =>
    service.addDay(id, ownerId, { title: 'Sightseeing' });
  const itineraryWithDay = async () => {
    const itinerary = await create();
    const day = await addDay(String(itinerary._id));
    return { itinerary, dayId: String(day._id) };
  };
  const budget = {
    category: BudgetCategory.FOOD,
    title: 'Lunch',
    amount: 10,
    currency: 'USD',
  };

  it('SCRUM-89/90: creates a private itinerary, normalizes currency, and lists only the owner records', async () => {
    const itinerary = await service.createItinerary(ownerId, {
      title: '  Paris  ',
      startDate: '2027-06-15T14:00:00Z',
      displayCurrency: 'eur',
    });
    await service.createItinerary(otherId, {
      title: 'Other trip',
      startDate: '2027-06-15',
    });
    expect(itinerary.title).toBe('Paris');
    expect(itinerary.visibility).toBe(ItineraryVisibility.PRIVATE);
    expect(itinerary.startDate.toISOString()).toBe('2027-06-15T00:00:00.000Z');
    expect(itinerary.displayCurrency).toBe('EUR');
    const result = await service.listMyItineraries(ownerId, {
      page: 1,
      limit: 1,
      search: 'Paris',
    });
    expect(result.items.map((item) => item.title)).toEqual(['Paris']);
    expect(result.pagination.total).toBe(1);
  });

  it('SCRUM-89: rejects unsupported currency, absent reference currency, and missing country IDs', async () => {
    await expect(
      service.createItinerary(ownerId, {
        title: 'Trip',
        startDate: '2027-06-15',
        displayCurrency: 'ZZZ',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createItinerary(ownerId, {
        title: 'Trip',
        startDate: '2027-06-15',
        countries: [new Types.ObjectId().toString()],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await reference.countryModel.deleteMany({});
    await expect(create()).rejects.toBeInstanceOf(BadRequestException);
  });

  it('SCRUM-91: enforces ownership, permits admin reads, and rejects invalid or missing IDs', async () => {
    const itinerary = await create();
    await expect(
      service.getItinerary(String(itinerary._id), stranger),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.getItinerary(String(itinerary._id), {
        ...stranger,
        role: Role.ADMIN,
      }),
    ).resolves.toHaveProperty('title', 'Test trip');
    await expect(
      service.getItinerary('invalid-id', user),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.getItinerary(new Types.ObjectId().toString(), user),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('SCRUM-92/94/95: derives day dates and updates city metadata and the start date', async () => {
    const { itinerary, dayId } = await itineraryWithDay();
    const id = String(itinerary._id);
    await service.updateDay(id, dayId, ownerId, {
      cityName: 'Paris',
      notes: 'Museum',
    });
    const updated = await service.updateItinerary(id, ownerId, {
      startDate: '2027-06-20',
      visibility: ItineraryVisibility.PUBLIC,
    });
    expect(updated.days[0]).toMatchObject({
      dayNumber: 1,
      cityName: 'Paris',
      notes: 'Museum',
    });
    expect(updated.days[0].date.toISOString()).toBe('2027-06-20T00:00:00.000Z');
  });

  it('SCRUM-97: reorders IDs, renumbers days, and rejects duplicates and incomplete permutations', async () => {
    const { itinerary, dayId } = await itineraryWithDay();
    const id = String(itinerary._id);
    const second = await addDay(id);
    const result = await service.reorderDays(id, ownerId, {
      dayIds: [String(second._id), dayId],
    });
    expect(
      result.days.map((day) => [
        String(day._id),
        day.dayNumber,
        day.date.toISOString().slice(0, 10),
      ]),
    ).toEqual([
      [String(second._id), 1, '2027-06-15'],
      [dayId, 2, '2027-06-16'],
    ]);
    await expect(
      service.reorderDays(id, ownerId, { dayIds: [dayId, dayId] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.reorderDays(id, ownerId, { dayIds: [dayId] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('SCRUM-96: deletes day children, clears transport day references, and renumbers remaining dates', async () => {
    const { itinerary, dayId } = await itineraryWithDay();
    const id = String(itinerary._id);
    await addDay(id);
    await service.addActivity(id, dayId, ownerId, { title: 'Museum' });
    await service.addBudgetEntry(id, dayId, ownerId, budget);
    const transport = await service.addTransportCost(id, ownerId, {
      amount: 15,
      currency: 'USD',
      departureDayId: dayId,
    });
    await service.deleteDay(id, dayId, ownerId);
    const updated = await service.itineraryModel.findById(id).orFail();
    expect(updated.days).toHaveLength(1);
    expect(updated.days[0].dayNumber).toBe(1);
    expect(updated.days[0].date.toISOString().slice(0, 10)).toBe('2027-06-15');
    expect(await service.activityModel.countDocuments()).toBe(0);
    expect(await service.budgetEntryModel.countDocuments()).toBe(0);
    expect(
      (await service.transportCostModel.findById(transport._id).orFail())
        .departureDayId,
    ).toBeNull();
  });

  it('SCRUM-95/96/97: normalizes uppercase day IDs and never deletes the wrong day', async () => {
    const { itinerary, dayId } = await itineraryWithDay();
    const id = String(itinerary._id);
    const second = await addDay(id);
    expect(
      await service.updateDay(id, dayId.toUpperCase(), ownerId, {
        title: 'Changed',
      }),
    ).toHaveProperty('title', 'Changed');
    await expect(
      service.reorderDays(id, ownerId, {
        dayIds: [dayId, dayId.toUpperCase()],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await service.reorderDays(id, ownerId, {
      dayIds: [dayId.toUpperCase(), String(second._id).toUpperCase()],
    });
    await service.deleteDay(id, dayId.toUpperCase(), ownerId);
    expect(
      (await service.itineraryModel.findById(id).orFail()).days.map((day) =>
        String(day._id),
      ),
    ).toEqual([String(second._id)]);
  });

  it('SCRUM-96: rolls child deletion back when the itinerary save fails', async () => {
    const { itinerary, dayId } = await itineraryWithDay();
    const activity = await service.addActivity(
      String(itinerary._id),
      dayId,
      ownerId,
      { title: 'Museum' },
    );
    const save = jest
      .spyOn(
        service.itineraryModel.prototype as { save: () => Promise<unknown> },
        'save',
      )
      .mockRejectedValueOnce(new Error('write failed'));
    await expect(
      service.deleteDay(String(itinerary._id), dayId, ownerId),
    ).rejects.toThrow('write failed');
    save.mockRestore();
    expect(
      await service.activityModel.exists({ _id: activity._id }),
    ).not.toBeNull();
    expect(
      (await service.itineraryModel.findById(itinerary._id).orFail()).days,
    ).toHaveLength(1);
  });

  it('SCRUM-98/99/100: creates, updates, and deletes activities with valid day and time checks', async () => {
    const { itinerary, dayId } = await itineraryWithDay();
    const id = String(itinerary._id);
    const activity = await service.addActivity(id, dayId, ownerId, {
      title: 'Museum',
      startTime: '09:00',
      endTime: '11:00',
    });
    await expect(
      service.updateActivity(String(activity._id), otherId, {
        title: 'Wrong owner',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const updated = await service.updateActivity(
      String(activity._id),
      ownerId,
      { title: 'Gallery', endTime: '12:30' },
    );
    expect(updated.title).toBe('Gallery');
    await expect(
      service.updateActivity(String(activity._id), ownerId, {
        endTime: '08:00',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.addActivity(id, new Types.ObjectId().toString(), ownerId, {
        title: 'Missing day',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await service.deleteActivity(String(activity._id), ownerId);
    expect(await service.activityModel.countDocuments()).toBe(0);
  });

  it('SCRUM-101/102: uploads a multipart image, validates size/MIME, and removes it', async () => {
    const { itinerary, dayId } = await itineraryWithDay();
    const activity = await service.addActivity(
      String(itinerary._id),
      dayId,
      ownerId,
      { title: 'Photo' },
    );
    const url = `/api/activities/${String(activity._id)}/images`;
    await request(server())
      .post(url)
      .set('x-test-user', otherId)
      .attach('file', png, { filename: 'image.png', contentType: 'image/png' })
      .expect(403);
    await request(server())
      .post(url)
      .set('x-test-user', ownerId)
      .attach('file', Buffer.from('text'), {
        filename: 'file.txt',
        contentType: 'text/plain',
      })
      .expect(400);
    await request(server())
      .post(url)
      .set('x-test-user', ownerId)
      .attach('file', Buffer.alloc(2048), {
        filename: 'large.png',
        contentType: 'image/png',
      })
      .expect(413);
    await request(server())
      .post(url)
      .set('x-test-user', ownerId)
      .attach('file', Buffer.from('<html>not an image</html>'), {
        filename: 'forged.png',
        contentType: 'image/png',
      })
      .expect(400);
    await request(server())
      .post(url)
      .set('x-test-user', ownerId)
      .attach('file', png, { filename: 'image.png', contentType: 'image/png' })
      .expect(201);
    const saved = await service.activityModel.findById(activity._id).orFail();
    const image = saved.images[0];
    expect(await readFile(path.join(directory, image.filename))).toEqual(png);
    await service.deleteActivityImage(
      String(activity._id),
      String(image._id),
      ownerId,
    );
    await expect(
      readFile(path.join(directory, image.filename)),
    ).rejects.toHaveProperty('code', 'ENOENT');
  });

  it('SCRUM-103/104/105: validates currency and owner before editing or deleting budget entries', async () => {
    const { itinerary, dayId } = await itineraryWithDay();
    const entry = await service.addBudgetEntry(
      String(itinerary._id),
      dayId,
      ownerId,
      budget,
    );
    await expect(
      service.updateBudgetEntry(String(entry._id), otherId, { amount: 999 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.updateBudgetEntry(String(entry._id), ownerId, {
        currency: 'ZZZ',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      (
        await service.updateBudgetEntry(String(entry._id), ownerId, {
          amount: 20,
          currency: 'EUR',
        })
      ).amount,
    ).toBe(20);
    await service.deleteBudgetEntry(String(entry._id), ownerId);
    expect(await service.budgetEntryModel.countDocuments()).toBe(0);
  });

  it('SCRUM-106/107/108: creates and edits transport costs with owner and day validation', async () => {
    const { itinerary, dayId } = await itineraryWithDay();
    const transport = await service.addTransportCost(
      String(itinerary._id),
      ownerId,
      {
        amount: 25,
        currency: 'USD',
        mode: TransportMode.TRAIN,
        departureDayId: dayId,
      },
    );
    await expect(
      service.deleteTransportCost(String(transport._id), otherId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      (
        await service.updateTransportCost(String(transport._id), ownerId, {
          amount: 30,
          notes: 'Express',
        })
      ).notes,
    ).toBe('Express');
    await expect(
      service.updateTransportCost(String(transport._id), ownerId, {
        departureDayId: new Types.ObjectId().toString(),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await service.deleteTransportCost(String(transport._id), ownerId);
    expect(await service.transportCostModel.countDocuments()).toBe(0);
  });

  it('SCRUM-109: converts budgets and transport, reuses cached rates, and preserves private access', async () => {
    const { itinerary, dayId } = await itineraryWithDay();
    const id = String(itinerary._id);
    await service.addBudgetEntry(id, dayId, ownerId, budget);
    await service.addTransportCost(id, ownerId, { amount: 5, currency: 'EUR' });
    await service.exchangeRateModel.create({
      baseCurrency: 'USD',
      targetCurrency: 'EUR',
      rate: 0.9,
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const get = jest.spyOn(http, 'get');
    const result = await service.getBudgetSummary(
      id,
      { currency: 'EUR' },
      user,
    );
    expect(result.total).toBe(14);
    expect(result.totalsByCategory).toMatchObject({
      [budget.category]: 9,
      TRANSPORT: 5,
    });
    expect(get).not.toHaveBeenCalled();
    await expect(service.getBudgetSummary(id, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.getBudgetSummary(id, {}, stranger),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('SCRUM-109: returns 503 for unavailable FX configuration', async () => {
    const { itinerary, dayId } = await itineraryWithDay();
    await service.addBudgetEntry(String(itinerary._id), dayId, ownerId, budget);
    await expect(
      service.getBudgetSummary(
        String(itinerary._id),
        { currency: 'EUR' },
        user,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('SCRUM-109: caches upstream rates and handles network and malformed responses', async () => {
    const { itinerary, dayId } = await itineraryWithDay();
    const id = String(itinerary._id);
    await service.addBudgetEntry(id, dayId, ownerId, budget);
    jest
      .spyOn(service.configService, 'get')
      .mockImplementation((key: string) =>
        key === 'fxRates.apiKey'
          ? 'integration-only-placeholder'
          : 'https://api.fxratesapi.com',
      );
    const get = jest.spyOn(http, 'get').mockReturnValue(
      of({
        data: { success: true, base: 'USD', rates: { EUR: 0.8 } },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: { headers: new AxiosHeaders() },
      }),
    );
    expect(
      (await service.getBudgetSummary(id, { currency: 'EUR' }, user)).total,
    ).toBe(8);
    expect(
      (await service.getBudgetSummary(id, { currency: 'EUR' }, user)).total,
    ).toBe(8);
    expect(get).toHaveBeenCalledTimes(1);
    await service.exchangeRateModel.deleteMany({});
    get.mockReturnValueOnce(throwError(() => new Error('network failed')));
    await expect(
      service.getBudgetSummary(id, { currency: 'EUR' }, user),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    get.mockReturnValueOnce(
      of({
        data: { rates: { EUR: -1 } },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: { headers: new AxiosHeaders() },
      }),
    );
    await expect(
      service.getBudgetSummary(id, { currency: 'EUR' }, user),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('SCRUM-110/111: hides private/moderated itineraries and exposes safe author attribution', async () => {
    const visible = await create();
    const hidden = await create();
    await create();
    await service.updateItinerary(String(visible._id), ownerId, {
      visibility: ItineraryVisibility.PUBLIC,
    });
    await service.itineraryModel.updateOne(
      { _id: hidden._id },
      { visibility: ItineraryVisibility.PUBLIC, isHidden: true },
    );
    const result = await service.searchPublicItineraries({});
    expect(result.items).toHaveLength(1);
    const details = await service.getPublicItinerary(String(visible._id));
    expect(JSON.stringify(details)).not.toContain('passwordHash');
    expect(JSON.stringify(details)).toContain('Owner');
    await expect(
      service.getPublicItinerary(String(hidden._id)),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.searchPublicItineraries({ minDays: 4, maxDays: 2 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('SCRUM-112: deep-clones children and image files with new IDs, private visibility, and attribution', async () => {
    const { itinerary, dayId } = await itineraryWithDay();
    const id = String(itinerary._id);
    const activity = await service.addActivity(id, dayId, ownerId, {
      title: 'Museum',
    });
    await request(server())
      .post(`/api/activities/${String(activity._id)}/images`)
      .set('x-test-user', ownerId)
      .attach('file', png, { filename: 'image.png', contentType: 'image/png' })
      .expect(201);
    await service.addBudgetEntry(id, dayId, ownerId, budget);
    await service.addTransportCost(id, ownerId, {
      amount: 5,
      currency: 'USD',
      departureDayId: dayId,
    });
    await service.updateItinerary(id, ownerId, {
      visibility: ItineraryVisibility.PUBLIC,
    });
    const clone = await service.cloneItinerary(id, otherId);
    expect(clone.visibility).toBe(ItineraryVisibility.PRIVATE);
    expect(String(clone.clonedFromItinerary)).toBe(id);
    expect(String(clone.clonedFromUser)).toBe(ownerId);
    const clonedId = String(clone._id);
    const clonedActivity = await service.activityModel
      .findOne({ itinerary: clonedId })
      .orFail();
    const clonedBudget = await service.budgetEntryModel
      .findOne({ itinerary: clonedId })
      .orFail();
    expect(String(clonedActivity.user)).toBe(otherId);
    expect(String(clonedActivity.dayId)).not.toBe(dayId);
    expect(String(clonedBudget.dayId)).toBe(String(clonedActivity.dayId));
    const sourceActivity = await service.activityModel
      .findById(activity._id)
      .orFail();
    const sourceImage = sourceActivity.images[0];
    expect(clonedActivity.images[0].filename).not.toBe(sourceImage.filename);
    await service.deleteActivityImage(
      String(activity._id),
      String(sourceImage._id),
      ownerId,
    );
    expect(
      await readFile(path.join(directory, clonedActivity.images[0].filename)),
    ).toEqual(png);
    expect(
      (await service.itineraryModel.findById(id).orFail()).cloneCount,
    ).toBe(1);
    expect(clone.attachedFlightBookings).toEqual([]);
  });

  it('SCRUM-112: refuses cloning private itineraries and cleans up a failed child copy', async () => {
    const { itinerary, dayId } = await itineraryWithDay();
    const id = String(itinerary._id);
    await expect(service.cloneItinerary(id, otherId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await service.addBudgetEntry(id, dayId, ownerId, budget);
    await service.updateItinerary(id, ownerId, {
      visibility: ItineraryVisibility.PUBLIC,
    });
    jest
      .spyOn(service.budgetEntryModel, 'insertMany')
      .mockRejectedValueOnce(new Error('copy failed'));
    await expect(service.cloneItinerary(id, otherId)).rejects.toThrow(
      'copy failed',
    );
    expect(await service.itineraryModel.countDocuments()).toBe(1);
    expect(
      (await service.itineraryModel.findById(id).orFail()).cloneCount,
    ).toBe(0);
  });

  it('SCRUM-113: groups city stays and only suggests hotels with a room for every night', async () => {
    const { itinerary, dayId } = await itineraryWithDay();
    const country = await reference.countryModel
      .findOne({ code: 'FR' })
      .orFail();
    const city = await reference.cityModel.create({
      name: 'Paris',
      country: country._id,
      countryCode: 'FR',
    });
    const id = String(itinerary._id);
    await service.updateDay(id, dayId, ownerId, { cityId: String(city._id) });
    await service.addDay(id, ownerId, { cityId: String(city._id) });
    const hotels = service.hotelsService;
    const hotel = await hotels.hotelModel.create({
      name: 'Available hotel',
      city: city._id,
      address: 'Test address',
    });
    const room = await hotels.roomModel.create({
      hotel: hotel._id,
      name: 'Double',
      roomType: 'Double',
      maxOccupancy: 2,
      basePricePerNight: 100,
    });
    await hotels.roomAvailabilityModel.create([
      {
        hotel: hotel._id,
        room: room._id,
        date: new Date('2027-06-15'),
        totalUnits: 2,
      },
      {
        hotel: hotel._id,
        room: room._id,
        date: new Date('2027-06-16'),
        totalUnits: 2,
      },
    ]);
    const result = await service.searchHotelsForItinerary(id, ownerId, {});
    expect(result.stays).toHaveLength(1);
    expect(result.stays[0].hotels).toHaveLength(1);
    expect(result.stays[0].checkOutDate.toISOString().slice(0, 10)).toBe(
      '2027-06-17',
    );
    await hotels.roomAvailabilityModel.updateOne(
      { date: new Date('2027-06-16') },
      { isBlocked: true },
    );
    expect(
      (await service.searchHotelsForItinerary(id, ownerId, {})).stays[0].hotels,
    ).toEqual([]);
    expect(
      (await service.searchHotelsForItinerary(id, ownerId, { endDay: 1 }))
        .stays[0].hotels,
    ).toHaveLength(1);
    await expect(
      service.searchHotelsForItinerary(id, otherId, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('SCRUM-114: searches city transitions on the destination day in the origin airport timezone', async () => {
    const country = await reference.countryModel
      .findOne({ code: 'US' })
      .orFail();
    const [origin, destination] = await reference.cityModel.create([
      { name: 'New York', country: country._id, countryCode: 'US' },
      { name: 'Boston', country: country._id, countryCode: 'US' },
    ]);
    const itinerary = await create();
    const id = String(itinerary._id);
    await service.addDay(id, ownerId, { cityId: String(origin._id) });
    await service.addDay(id, ownerId, { cityId: String(destination._id) });
    const [departure, arrival] = await reference.airportModel.create([
      {
        name: 'JFK',
        iataCode: 'JFK',
        city: origin._id,
        timezone: 'America/New_York',
      },
      {
        name: 'BOS',
        iataCode: 'BOS',
        city: destination._id,
        timezone: 'America/New_York',
      },
    ]);
    const flights = service.flightsService;
    const airline = await flights.airlineModel.create({
      name: 'Test Airline',
      iataCode: 'TA',
    });
    await flights.flightModel.create([
      {
        airline: airline._id,
        flightNumber: 'TA101',
        departureAirport: departure._id,
        arrivalAirport: arrival._id,
        departureTime: new Date('2027-06-17T02:00:00Z'),
        arrivalTime: new Date('2027-06-17T03:00:00Z'),
        durationMinutes: 60,
      },
      {
        airline: airline._id,
        flightNumber: 'TA102',
        departureAirport: departure._id,
        arrivalAirport: arrival._id,
        departureTime: new Date('2027-06-16T02:00:00Z'),
        arrivalTime: new Date('2027-06-16T03:00:00Z'),
        durationMinutes: 60,
      },
    ]);
    const result = await service.searchFlightsForItinerary(id, ownerId, {});
    expect(result.routes[0].departureDate.toISOString().slice(0, 10)).toBe(
      '2027-06-16',
    );
    expect(result.flights.map((flight) => flight.flightNumber)).toEqual([
      'TA101',
    ]);
    await flights.airlineModel.updateOne(
      { _id: airline._id },
      { isActive: false },
    );
    expect(
      (await service.searchFlightsForItinerary(id, ownerId, {})).flights,
    ).toEqual([]);
  });

  it('SCRUM-115: attaches only owned confirmed bookings and avoids duplicate attachments', async () => {
    const itinerary = await create();
    const id = String(itinerary._id);
    const booking = await service.flightsService.flightBookingModel.create({
      bookingReference: 'TEST123',
      user: ownerId,
      legs: [],
      passengerCounts: {
        adults: 1,
        children: 0,
        infants: 0,
        totalSeatsRequired: 1,
      },
      baseFareTotal: 20,
      totalPrice: 20,
      status: BookingStatus.HELD,
    });
    const dto = {
      bookingType: BookingType.FLIGHT,
      bookingId: String(booking._id),
    };
    await expect(
      service.attachBooking(id, ownerId, dto),
    ).rejects.toBeInstanceOf(NotFoundException);
    await service.flightsService.flightBookingModel.updateOne(
      { _id: booking._id },
      { status: BookingStatus.CONFIRMED },
    );
    await service.attachBooking(id, ownerId, dto);
    expect(
      (await service.attachBooking(id, ownerId, dto)).attachedFlightBookings,
    ).toHaveLength(1);
    await service.flightsService.flightBookingModel.updateOne(
      { _id: booking._id },
      { user: otherId },
    );
    await expect(
      service.attachBooking(id, ownerId, dto),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('SCRUM-115: attaches confirmed hotel bookings after checking ownership', async () => {
    const itinerary = await create();
    const booking = await service.hotelsService.hotelBookingModel.create({
      bookingReference: 'HOTELTEST',
      user: ownerId,
      hotel: new Types.ObjectId(),
      rooms: [],
      checkInDate: new Date('2027-06-15'),
      checkOutDate: new Date('2027-06-16'),
      nights: 1,
      guestCount: 1,
      primaryGuestName: 'Test guest',
      primaryGuestEmail: 'guest@example.test',
      totalPrice: 100,
      status: BookingStatus.CONFIRMED,
    });
    const result = await service.attachBooking(String(itinerary._id), ownerId, {
      bookingType: BookingType.HOTEL,
      bookingId: String(booking._id),
    });
    expect(result.attachedHotelBookings.map(String)).toEqual([
      String(booking._id),
    ]);
  });

  it('HTTP routes: exercises itinerary, day, activity, budget, transport, public and contextual endpoints', async () => {
    const send = (
      method: 'get' | 'post' | 'patch' | 'delete',
      url: string,
      body?: object,
      status = 200,
    ) => {
      const call = request(server())
        [method](`/api/${url}`)
        .set('x-test-user', ownerId);
      return (body ? call.send(body) : call).expect(status);
    };
    await send(
      'post',
      'itineraries',
      { title: 'HTTP trip', startDate: '2027-06-15' },
      201,
    );
    const itinerary = await service.itineraryModel
      .findOne({ title: 'HTTP trip' })
      .orFail();
    const base = `itineraries/${String(itinerary._id)}`;
    await send('get', 'itineraries');
    await send('get', base);
    await send('patch', base, {
      title: 'Updated HTTP trip',
      visibility: ItineraryVisibility.PUBLIC,
    });
    await send('post', `${base}/days`, { title: 'Day 1' }, 201);
    await send('post', `${base}/days`, { title: 'Day 2' }, 201);
    const updated = await service.itineraryModel
      .findById(itinerary._id)
      .orFail();
    const [firstDayId, secondDayId] = updated.days.map((day) =>
      String(day._id),
    );
    await send('patch', `${base}/days/${firstDayId}`, { cityName: 'Paris' });
    await send('patch', `${base}/days/reorder`, {
      dayIds: [secondDayId, firstDayId],
    });
    await send(
      'post',
      `${base}/days/${firstDayId}/activities`,
      { title: 'HTTP activity' },
      201,
    );
    const activity = await service.activityModel
      .findOne({ itinerary: itinerary._id })
      .orFail();
    await send('patch', `activities/${String(activity._id)}`, {
      title: 'Updated activity',
    });
    await send('post', `${base}/days/${firstDayId}/budgets`, budget, 201);
    const entry = await service.budgetEntryModel
      .findOne({ itinerary: itinerary._id })
      .orFail();
    await send('patch', `budgets/${String(entry._id)}`, { amount: 25 });
    await send(
      'post',
      `${base}/transport-costs`,
      { amount: 5, currency: 'USD' },
      201,
    );
    const transport = await service.transportCostModel
      .findOne({ itinerary: itinerary._id })
      .orFail();
    await send('patch', `transport-costs/${String(transport._id)}`, {
      amount: 10,
    });
    await send('get', `${base}/budget-summary`);
    await request(server())
      .get('/api/itineraries/public/search?search=HTTP&minDays=2')
      .expect(200);
    await request(server())
      .get(`/api/itineraries/public/${String(itinerary._id)}`)
      .expect(200);
    await send('post', `${base}/clone`, undefined, 201);
    await send('get', `${base}/hotels?startDay=1&endDay=2`);
    await send('get', `${base}/flights?startDay=1&endDay=2`);
    await send('delete', `activities/${String(activity._id)}`);
    await send('delete', `budgets/${String(entry._id)}`);
    await send('delete', `transport-costs/${String(transport._id)}`);
    await send('delete', `${base}/days/${firstDayId}`);
    await send('delete', base);
    await send('get', base, undefined, 404);
  });

  it('SCRUM-116: streams a valid PDF for the owner or public audience and blocks private exports', async () => {
    const { itinerary } = await itineraryWithDay();
    const url = `/api/itineraries/${String(itinerary._id)}/pdf`;
    await request(server()).get(url).expect(404);
    const response = await request(server())
      .get(url)
      .set('x-test-user', ownerId)
      .expect(200)
      .expect('Content-Type', /application\/pdf/);
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect((response.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    await service.updateItinerary(String(itinerary._id), ownerId, {
      visibility: ItineraryVisibility.PUBLIC,
    });
    await request(server()).get(url).expect(200);
    await service.itineraryModel.updateOne(
      { _id: itinerary._id },
      { isHidden: true },
    );
    await request(server()).get(url).expect(404);
  });

  it('SCRUM-93: cascade-deletes activities, budgets and transport costs', async () => {
    const { itinerary, dayId } = await itineraryWithDay();
    const id = String(itinerary._id);
    await service.addActivity(id, dayId, ownerId, { title: 'Museum' });
    await service.addBudgetEntry(id, dayId, ownerId, budget);
    await service.addTransportCost(id, ownerId, { amount: 5, currency: 'USD' });
    await expect(service.deleteItinerary(id, otherId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await service.deleteItinerary(id, ownerId);
    expect(await service.itineraryModel.countDocuments()).toBe(0);
    expect(await service.activityModel.countDocuments()).toBe(0);
    expect(await service.budgetEntryModel.countDocuments()).toBe(0);
    expect(await service.transportCostModel.countDocuments()).toBe(0);
  });

  it('HTTP validation: rejects extra properties, invalid IDs, negative amounts, and accepts valid PATCH times', async () => {
    await request(server())
      .post('/api/itineraries')
      .send({ title: 'Trip', startDate: '2027-06-15' })
      .expect(401);
    await request(server())
      .post('/api/itineraries')
      .set('x-test-user', ownerId)
      .send({ title: 'Trip', startDate: '2027-06-15', user: otherId })
      .expect(400);
    await request(server())
      .post('/api/itineraries')
      .set('x-test-user', ownerId)
      .send({ title: '  ', startDate: '2027-06-15' })
      .expect(400);
    await request(server())
      .get('/api/itineraries/bad-id')
      .set('x-test-user', ownerId)
      .expect(400);
    const { itinerary, dayId } = await itineraryWithDay();
    await request(server())
      .post(`/api/itineraries/${String(itinerary._id)}/days/${dayId}/budgets`)
      .set('x-test-user', ownerId)
      .send({ ...budget, amount: -1 })
      .expect(400);
    const activity = await service.addActivity(
      String(itinerary._id),
      dayId,
      ownerId,
      { title: 'Museum', startTime: '09:00' },
    );
    await request(server())
      .patch(`/api/activities/${String(activity._id)}`)
      .set('x-test-user', ownerId)
      .send({ endTime: '12:30' })
      .expect(200);
  });

  it('Swagger publishes all 28 implemented endpoint operations', async () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    const operations = Object.values(document.paths).reduce(
      (sum, item) =>
        sum +
        Object.values(item ?? {}).filter(
          (operation: unknown) =>
            typeof operation === 'object' &&
            operation !== null &&
            'tags' in operation &&
            Array.isArray(operation.tags) &&
            operation.tags.includes('Itineraries & Budgeting'),
        ).length,
      0,
    );
    expect(operations).toBe(28);
    await request(server()).get('/api/docs/').expect(200);
  });
});
