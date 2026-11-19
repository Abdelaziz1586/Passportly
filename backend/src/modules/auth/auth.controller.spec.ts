import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { AccountStatus, Role } from '../../common/enums';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';

describe('AuthController (ACC-01 register)', () => {
  let controller: AuthController;
  const validationPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
  });

  const mockAuthService = {
    register: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('marks register endpoint as @Public()', () => {
    const reflector = new Reflector();
    const registerHandler = Object.getOwnPropertyDescriptor(
      AuthController.prototype,
      'register',
    )?.value as (...args: never[]) => unknown;
    const isPublic = reflector.get<boolean>(IS_PUBLIC_KEY, registerHandler);
    expect(isPublic).toBe(true);
  });

  it('delegates valid registration payload to AuthService.register', async () => {
    const expected = {
      id: '507f1f77bcf86cd799439011',
      email: 'traveler@example.com',
      firstName: 'Abdelaziz',
      lastName: 'Mohamed',
      preferredCurrency: 'USD',
      role: Role.REGISTERED_USER,
      status: AccountStatus.ACTIVE,
      isEmailVerified: false,
    };
    mockAuthService.register.mockResolvedValue(expected);

    const dto = (await validationPipe.transform(
      {
        email: '  Traveler@Example.com ',
        password: 'StrongPassword123!',
        firstName: 'Abdelaziz',
        lastName: 'Mohamed',
      },
      { type: 'body', metatype: RegisterDto },
    )) as RegisterDto;

    const result = await controller.register(dto);
    expect(result).toEqual(expected);
    expect(mockAuthService.register).toHaveBeenCalledWith(dto);
  });

  it('rejects weak passwords via ValidationPipe', async () => {
    await expect(
      validationPipe.transform(
        {
          email: 'traveler@example.com',
          password: 'weak',
          firstName: 'Abdelaziz',
          lastName: 'Mohamed',
        },
        { type: 'body', metatype: RegisterDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects role injection (e.g., ADMIN) via forbidNonWhitelisted', async () => {
    await expect(
      validationPipe.transform(
        {
          email: 'attacker@example.com',
          password: 'StrongPassword123!',
          firstName: 'Bad',
          lastName: 'Actor',
          role: 'ADMIN',
        },
        { type: 'body', metatype: RegisterDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects whitespace-only firstName or lastName', async () => {
    await expect(
      validationPipe.transform(
        {
          email: 'traveler@example.com',
          password: 'StrongPassword123!',
          firstName: '   ',
          lastName: 'Mohamed',
        },
        { type: 'body', metatype: RegisterDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
