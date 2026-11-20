import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppController } from './../src/app.controller';
import { AppService } from './../src/app.service';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './../src/common/guards/jwt-auth.guard';
import { RolesGuard } from './../src/common/guards/roles.guard';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    // Standalone public health smoke test; hotel integration tests exercise real database modules.
    const moduleFixture = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  it('/api/health is public and returns the actual health payload', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);
    const payload = response.body as {
      status: string;
      service: string;
      timestamp: string;
    };
    expect(payload.status).toBe('ok');
    expect(payload.service).toBe('travel-platform-backend');
    expect(Number.isFinite(Date.parse(payload.timestamp))).toBe(true);
  });

  afterAll(async () => {
    await app.close();
  });
});
