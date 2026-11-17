import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import * as express from 'express';
import * as path from 'path';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('port', 3000);
  const frontendUrl = configService.get<string>(
    'frontendUrl',
    'http://localhost:3001',
  );
  const cookieName = configService.get<string>(
    'jwt.cookieName',
    'access_token',
  );
  const uploadDir = path.resolve(
    configService.get<string>('uploads.dir', 'uploads'),
  );

  app.setGlobalPrefix('api');
  app.use(cookieParser());

  app.enableCors({
    origin: frontendUrl,
    credentials: true,
  });

  app.use('/uploads', express.static(uploadDir));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Travel Planning & Booking Platform API')
    .setDescription(
      'REST API documentation for Flights, Hotels, Payments, Itineraries, Blog, and Administration (Milestone 1)',
    )
    .setVersion('1.0')
    .addCookieAuth(cookieName, {
      type: 'apiKey',
      in: 'cookie',
      name: cookieName,
    })
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  await app.listen(port);
}
void bootstrap();
