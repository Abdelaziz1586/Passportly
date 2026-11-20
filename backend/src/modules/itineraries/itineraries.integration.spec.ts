import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  NotFoundException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import * as os from 'node:os';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import request from 'supertest';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ItineraryVisibility, Role } from '../../common/enums';
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
        const optionalRoute = false;
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
