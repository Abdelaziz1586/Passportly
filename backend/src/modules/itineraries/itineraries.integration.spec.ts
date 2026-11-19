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
