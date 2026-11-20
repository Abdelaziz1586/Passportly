import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { PostStatus, Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';
import { UpdatePostDto } from './dto/update-post.dto';

describe('BlogController (SCRUM-121 BLG-04/BLG-08 update post)', () => {
  let controller: BlogController;

  const validationPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const mockBlogService = {
    updatePost: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BlogController],
      providers: [{ provide: BlogService, useValue: mockBlogService }],
    }).compile();

    controller = module.get<BlogController>(BlogController);
  });

  it('requires authentication and Role.REGISTERED_USER on updatePost', () => {
    const reflector = new Reflector();
    const handler = Object.getOwnPropertyDescriptor(
      BlogController.prototype,
      'updatePost',
    )?.value as (...args: never[]) => unknown;

    expect(reflector.get<boolean>(IS_PUBLIC_KEY, handler)).toBeUndefined();
    expect(reflector.get<Role[]>(ROLES_KEY, handler)).toEqual([
      Role.REGISTERED_USER,
    ]);
  });

  it('validates UpdatePostDto and delegates to BlogService.updatePost', async () => {
    const postId = '673c1f2a9c4b2d001f8a2222';
    const dto = (await validationPipe.transform(
      {
        title: '  Updated Title  ',
        status: PostStatus.PUBLISHED,
        tags: ['  Egypt ', 'Luxor'],
      },
      { type: 'body', metatype: UpdatePostDto },
    )) as UpdatePostDto;

    const user: AuthenticatedUser = {
      userId: '673c1f2a9c4b2d001f8a1111',
      email: 'abdullah@example.com',
      role: Role.REGISTERED_USER,
      jti: 'jti-1',
    };
    const expected = { id: postId, title: 'Updated Title' };
    mockBlogService.updatePost.mockResolvedValue(expected);

    const result = await controller.updatePost(postId, user, dto);

    expect(result).toEqual(expected);
    expect(mockBlogService.updatePost).toHaveBeenCalledWith(
      postId,
      user.userId,
      dto,
    );
  });

  it('rejects non-whitelisted fields via ValidationPipe', async () => {
    await expect(
      validationPipe.transform(
        { likesCount: 999 },
        { type: 'body', metatype: UpdatePostDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
