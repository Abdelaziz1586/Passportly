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
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AxiosHeaders } from 'axios';
import type { Request } from 'express';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import * as os from 'node:os';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { of, throwError } from 'rxjs';
import request from 'supertest';
import { OPTIONAL_AUTH_KEY } from '../../common/decorators/optional-auth.decorator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import {
  BudgetCategory,
  ItineraryVisibility,
  Role,
  TransportMode,
} from '../../common/enums';
import { RolesGuard } from '../../common/guards/roles.guard';
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
  it('SCRUM-89: creates an owned private itinerary through HTTP', async () => {
    await request(server())
      .post('/api/itineraries')
      .set('x-test-user', ownerId)
      .send({ title: 'HTTP creation', startDate: '2027-06-15' })
      .expect(201);
    const saved = await service.itineraryModel
      .findOne({ title: 'HTTP creation' })
      .orFail();
    expect(String(saved.user)).toBe(ownerId);
    expect(saved.visibility).toBe(ItineraryVisibility.PRIVATE);
  });
});
