import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { BlogController } from './blog.controller';
import { BlogService } from './blog.service';
import { CreateCommentDto } from './dto/create-comment.dto';

describe('BlogController (SCRUM-123 BLG-05 add comment)', () => {
  let controller: BlogController;

  const validationPipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const mockBlogService = {
    addComment: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BlogController],
      providers: [{ provide: BlogService, useValue: mockBlogService }],
    }).compile();

    controller = module.get<BlogController>(BlogController);
  });

  it('requires authentication and Role.REGISTERED_USER on addComment', () => {
    const reflector = new Reflector();
    const handler = Object.getOwnPropertyDescriptor(
      BlogController.prototype,
      'addComment',
    )?.value as (...args: never[]) => unknown;

    expect(reflector.get<boolean>(IS_PUBLIC_KEY, handler)).toBeUndefined();
    expect(reflector.get<Role[]>(ROLES_KEY, handler)).toEqual([
      Role.REGISTERED_USER,
    ]);
  });

  it('validates CreateCommentDto and delegates to BlogService.addComment', async () => {
    const postId = '673c1f2a9c4b2d001f8a2222';
    const dto = (await validationPipe.transform(
      { content: '  Very helpful guide!  ' },
      { type: 'body', metatype: CreateCommentDto },
    )) as CreateCommentDto;

    const user: AuthenticatedUser = {
      userId: '673c1f2a9c4b2d001f8a1111',
      email: 'abdullah@example.com',
      role: Role.REGISTERED_USER,
      jti: 'jti-1',
    };
    const expected = {
      id: '673c1f2a9c4b2d001f8a4444',
      post: postId,
      author: user.userId,
      content: 'Very helpful guide!',
      isHidden: false,
    };
    mockBlogService.addComment.mockResolvedValue(expected);

    const result = await controller.addComment(postId, user, dto);

    expect(result).toEqual(expected);
    expect(mockBlogService.addComment).toHaveBeenCalledWith(
      postId,
      user.userId,
      dto,
    );
  });

  it('rejects empty comment content and non-whitelisted fields via ValidationPipe', async () => {
    await expect(
      validationPipe.transform(
        { content: '   ' },
        { type: 'body', metatype: CreateCommentDto },
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(
      validationPipe.transform(
        { content: 'Valid comment', isHidden: true },
        { type: 'body', metatype: CreateCommentDto },
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
